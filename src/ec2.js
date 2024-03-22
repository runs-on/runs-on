const {
  EC2Client,
  paginateDescribeInstanceTypes,
  DescribeInstancesCommand,
  DescribeImagesCommand,
  RunInstancesCommand,
  waitUntilInstanceRunning,
  TerminateInstancesCommand,
} = require("@aws-sdk/client-ec2");
const memoize = require("lru-memoize").default;

const { flatMapInput, base64Scripts } = require("./utils");

const {
  DEFAULT_ARCHITECTURE,
  DEFAULT_PLATFORM,
  DEFAULT_CPU,
  DEFAULT_IOPS,
  STACK_TAGS,
  SUPPORTED_ARCHITECTURES,
  STACK_FILTERS,
  DEFAULT_FAMILY_FOR_PLATFORM,
  DEFAULT_THROUGHPUT,
} = require("./constants");

const logger = require("./logger").getLogger();
const ec2Client = new EC2Client();
// Specific client for RunInstances / TerminateInstances, to disable retries, and log API calls.
// Disabling retries is necessary since the default quota for RunInstances is 2/s, and so having the client automatically retry for up to 3 (by default) attempts can quickly deplete the quota, and lead to RequestLimitExceeded errors.
// (e.g. InsufficientInstanceCapacity client error, then followed by RequestLimitExceeded error).
const ec2NoRetryClient = new EC2Client({
  logger: logger,
  maxAttempts: 1,
});

function extractInfosFromImage(image) {
  return {
    ami: image.ImageId,
    platform: image.PlatformDetails,
    name: image.Name,
    arch: image.Architecture,
    minHddSize: image.BlockDeviceMappings[0].Ebs.VolumeSize,
    // make sure we fetch the real owner
    owner: image.OwnerId,
  };
}

const findCustomImage = memoize(10, (a, b) => {
  return JSON.stringify(a) === JSON.stringify(b);
})(_findCustomImage);

async function _findCustomImage(inputs) {
  const {
    ami,
    arch = DEFAULT_ARCHITECTURE,
    platform = DEFAULT_PLATFORM,
    name,
    owner,
  } = inputs;

  const params = ami
    ? { ImageIds: [String(ami)] }
    : {
        Filters: [
          { Name: "name", Values: [String(name)] },
          {
            Name: "architecture",
            Values: [String(SUPPORTED_ARCHITECTURES[arch] || arch)],
          },
          { Name: "state", Values: ["available"] },
        ],
        Owners: [String(owner)],
      };

  // according to AWS docs, the platform can only have the value of windows
  if (platform === "windows") {
    params.Filters.push({ Name: "platform", Values: ["windows"] });
  }

  let images = [];
  try {
    const response = await ec2Client.send(new DescribeImagesCommand(params));
    // Sort to find the most recent one by name
    images = response.Images.sort((a, b) => b.Name.localeCompare(a.Name));
  } catch (e) {
    logger.warn(`Unable to find matching image for ${JSON.stringify(inputs)}`);
  }

  if (images.length === 0) {
    return null;
  } else {
    return { ...inputs, ...extractInfosFromImage(images[0]) };
  }
}

const _findInstanceTypesMatching = async function ({ families, filters }) {
  let matchingInstanceTypes = [];
  let totalPages = 0;

  const paginator = paginateDescribeInstanceTypes(
    { client: ec2Client, pageSize: 100 },
    { Filters: filters }
  );
  for await (const page of paginator) {
    // Concatenate the results from each page.
    totalPages += 1;
    matchingInstanceTypes.push(...page.InstanceTypes);
  }

  // sort by instance type name ascending
  matchingInstanceTypes = matchingInstanceTypes.sort((a, b) => {
    return a.InstanceType.localeCompare(b.InstanceType);
  });

  const matchingInstanceTypesByFamily = matchingInstanceTypes.reduce(
    (acc, instanceType) => {
      const family = instanceType.InstanceType.split(".")[0];
      if (!acc[family]) {
        acc[family] = [];
      }
      acc[family].push(instanceType);
      // sort by vCPU ascending
      acc[family] = acc[family].sort(
        (a, b) => a.VCpuInfo.DefaultVCpus - b.VCpuInfo.DefaultVCpus
      );
      return acc;
    },
    {}
  );

  const sortedMatchingInstanceTypes = new Set();

  for (const family of families) {
    // find matching instances for each family, from matchingInstanceTypesByFamily
    // a family can have a wildcard in its name
    const familyRegex = new RegExp(`^${family.replace("*", ".*")}$`);
    // find groups of instance types that match the family
    Object.entries(matchingInstanceTypesByFamily)
      .filter(([familyName]) => {
        return familyName.match(familyRegex);
      })
      .forEach(([_, instanceTypes]) => {
        instanceTypes.forEach((instanceType) => {
          sortedMatchingInstanceTypes.add(instanceType);
        });
      });
  }

  const selectedInstanceTypes = [...sortedMatchingInstanceTypes].slice(0, 10);
  return selectedInstanceTypes;
};
const findInstanceTypesMatching = memoize(40, (a, b) => {
  return JSON.stringify(a) === JSON.stringify(b);
})(_findInstanceTypesMatching);

function instanceTypeFilters(inputs) {
  const {
    arch = DEFAULT_ARCHITECTURE,
    platform = DEFAULT_PLATFORM,
    cpu = DEFAULT_CPU,
    ram,
    family,
  } = inputs;

  let familyValues = flatMapInput(family);
  const cpuValues = flatMapInput(cpu).map((i) => Number(i));
  const ramValues = flatMapInput(ram).map((i) => Number(i) * 1024);

  if (familyValues.length === 0) {
    familyValues = [...DEFAULT_FAMILY_FOR_PLATFORM[platform]];
  }

  const families = [];
  for (const family of familyValues) {
    if (family.includes(".")) {
      families.push(family);
    } else {
      families.push(`${family}*`);
    }
  }

  // https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/describe-instance-types.html
  const filters = [
    {
      //  The supported architecture (i386 | x86_64 | arm64 ).
      Name: "processor-info.supported-architecture",
      Values: [`${SUPPORTED_ARCHITECTURES[arch] || arch}`],
    },
    {
      Name: "supported-usage-class",
      Values: ["on-demand", "spot"],
    },
    {
      Name: "bare-metal",
      Values: ["false"],
    },
  ];
  // if (families.length <= 0) {
  //   params.Filters.push({
  //     Name: "current-generation",
  //     Values: ["true"],
  //   });
  // }
  filters.push({
    Name: "instance-type",
    Values: families,
  });
  if (cpuValues.length > 0) {
    filters.push({
      Name: "vcpu-info.default-vcpus",
      Values: cpuValues,
    });
  }
  if (ramValues.length > 0) {
    filters.push({
      Name: "memory-info.size-in-mib",
      Values: ramValues,
    });
  }

  return { families, filters };
}

function generateLaunchTemplate({ stackOutputs, instanceImage, runnerSpec }) {
  const { subnetId, securityGroupId, instanceProfileArn } = stackOutputs;
  const {
    iops = DEFAULT_IOPS,
    hdd,
    throughput = DEFAULT_THROUGHPUT,
  } = runnerSpec;
  const { ami, minHddSize } = instanceImage;

  // io2 doesn't bring much improvement, unless you buy more than 10k IOPS, which is expensive
  // so only supporting gp3 for now
  const storageType = "gp3";

  let finalIops = parseInt(iops);
  if (isNaN(finalIops)) {
    finalIops = DEFAULT_IOPS;
  }
  // gp3 is 3000 min, so do not accept anything less
  // make sure final iops is not more than 4000, which is max for gp3
  finalIops = Math.min(Math.max(finalIops, 3000), 4000);

  // https://aws.amazon.com/ebs/pricing/?nc1=h_ls
  let finalThroughput = parseInt(throughput);
  if (isNaN(finalThroughput)) {
    finalThroughput = DEFAULT_THROUGHPUT;
  }
  // allow reducing throughput from default, but not less than 250 MB/s
  // make sure final throughput is no more than 25% of final IOPS, otherwise AWS will raise an error
  finalThroughput = Math.min(Math.max(finalThroughput, 250), finalIops * 0.25);

  // gp3 storage is $0.08/GB-month, i.e. for 50GB: 50*0.08/(60*24*30)=$0.000092/min
  let finalHdd = parseInt(hdd);
  if (isNaN(finalHdd)) {
    // if no disk size specified, take the AMI size and add 10GB
    finalHdd = minHddSize + 10;
  } else {
    // otherwise, make sure we don't go below the AMI disk size
    finalHdd = Math.max(minHddSize, finalHdd);
  }

  // larger images will get max throughput
  if (minHddSize >= 30) {
    finalThroughput = 1000;
    finalIops = 4000;
  }

  // Create the instance
  let instanceParams = {
    SubnetId: subnetId,
    SecurityGroupIds: [securityGroupId],
    ImageId: ami,
    MinCount: 1,
    MaxCount: 1,
    // Setting this to true, even though most instances don't care - https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-optimized.html
    EbsOptimized: true,
    InstanceInitiatedShutdownBehavior: "terminate",
    // UserData: Buffer.from(userData).toString('base64'),
    BlockDeviceMappings: [
      {
        DeviceName: "/dev/sda1", // Device name for the root volume
        Ebs: {
          VolumeSize: finalHdd, // Size of the root EBS volume in GB
          VolumeType: String(storageType),
        },
        TagSpecifications: [{ ResourceType: "volume", Tags: STACK_TAGS }],
      },
    ],
    // https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html#instance-profiles
    IamInstanceProfile: {
      Arn: instanceProfileArn,
    },
    MetadataOptions: {
      // Specify IMDSv2
      HttpTokens: "required",
      HttpPutResponseHopLimit: 3,
    },
  };

  // https://aws.amazon.com/ebs/pricing/?nc1=h_ls
  // Throughput costs $0.040/MB/s-month over 125, i.e. for 400MB/s: (400-125)*0.040/(60*24*30)=$0.00025/min
  instanceParams.BlockDeviceMappings[0].Ebs.Throughput = finalThroughput;
  instanceParams.BlockDeviceMappings[0].Ebs.Iops = finalIops;

  return instanceParams;
}

// Attempt to create a single EC2 instance among the given instance types
// If spot is used for the first pass and no instance can be found, it will attempt a second pass without spot
// https://docs.aws.amazon.com/AWSEC2/latest/APIReference/throttling.html
const createEC2Instance = async function ({
  logger,
  instanceTypes,
  instanceName,
  launchTemplate,
  userDataConfig,
  userDataTemplate,
  spot,
  tags = [],
}) {
  const userData = userDataTemplate({
    ...userDataConfig,
    launchedAt: new Date().toISOString(),
    preinstallScripts: base64Scripts(userDataConfig.preinstall),
  });

  // this is only a shallow clone, so make sure to always override at the first level
  const finalLaunchTemplate = { ...launchTemplate };

  finalLaunchTemplate.TagSpecifications = [
    {
      ResourceType: "instance",
      Tags: [{ Key: "Name", Value: instanceName }, ...STACK_TAGS, ...tags],
    },
  ];

  finalLaunchTemplate.UserData = Buffer.from(userData).toString("base64");

  const createParams = { logger, finalLaunchTemplate, instanceTypes, tags };

  if (spot) {
    logger.info(`→ Using spot instances`);
    finalLaunchTemplate.InstanceMarketOptions = {
      MarketType: "spot",
      SpotOptions: {
        // https://docs.aws.amazon.com/whitepapers/latest/cost-optimization-leveraging-ec2-spot-instances/how-spot-instances-work.html
        SpotInstanceType: "one-time",
        InstanceInterruptionBehavior: "terminate",
      },
    };
  }

  let result = await createSingleEC2Instance(createParams);

  if (spot && !result.instance) {
    // attempt one last time without spot instances
    logger.info(`→ Attempting to create instance without spot instances...`);
    delete createParams.finalLaunchTemplate.InstanceMarketOptions;
    result = await createSingleEC2Instance(createParams);
  }

  return result;
};

// Attempt to create a single EC2 instance among the given instance types
async function createSingleEC2Instance({
  logger,
  tags = [],
  instanceTypes,
  finalLaunchTemplate,
}) {
  let error;
  let instance;

  // Try each instance type until one is successfully created
  for (const instanceType of instanceTypes) {
    // reset error
    error = null;
    // make sure we're using a duplicate of the instance params since we're modifying it
    let launchTemplateForType = { ...finalLaunchTemplate };

    // set cpucredits to unlimited for burstable instances, even though this can cost more in the end that the equivalent non-burstable instance.
    // in the long run, users will choose whether their workload is better with burstable or non-burstable family types
    // https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode.html
    // https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode-concepts.html
    if (instanceType.InstanceType.startsWith("t")) {
      launchTemplateForType.CreditSpecification = {
        CpuCredits: "unlimited",
      };
    }

    if (instanceType.InstanceStorageSupported) {
      launchTemplateForType.BlockDeviceMappings = [
        {
          DeviceName: "/dev/sdb", // Device name for the instance store volume
          VirtualName: "ephemeral0", // Name used internally by AWS for the instance store volume,
          TagSpecifications: [
            { ResourceType: "volume", Tags: [...STACK_TAGS, ...tags] },
          ],
        },
        ...launchTemplateForType.BlockDeviceMappings,
      ];
    }

    try {
      logger.info(
        `→ Attempting to create instance with type ${instanceType.InstanceType}...`
      );
      launchTemplateForType.InstanceType = instanceType.InstanceType;
      const runCommand = new RunInstancesCommand(launchTemplateForType);
      const instanceResponse = await ec2NoRetryClient.send(runCommand);
      const instance = instanceResponse.Instances[0];
      logger.info(
        `✅ EC2 Instance created with ID: ${instance.InstanceId} and type ${instanceType.InstanceType}`
      );
      return { instance, error };
    } catch (e) {
      error = `⚠️ Failed to create instance with type ${instanceType.InstanceType}: ${e}.`;
      logger.warn(error);
    }
  }
  return { instance, error };
}

async function fetchInstanceDetails(instanceId) {
  // Define the parameters for the DescribeInstances command
  const params = {
    Filters: [
      {
        Name: "instance-id",
        Values: [instanceId],
      },
    ],
  };

  // Fetch the instance details
  const describeInstancesCommand = new DescribeInstancesCommand(params);
  const data = await ec2Client.send(describeInstancesCommand);
  const instances = data.Reservations.flatMap(
    (reservation) => reservation.Instances
  );
  if (instances.length > 0) {
    return instances[0];
  } else {
    throw new Error(`❌ No instances found with ID ${instanceId}`);
  }
}

async function terminateInstance(instanceName, { logger }) {
  try {
    const describeParams = {
      Filters: [
        {
          Name: "tag:Name",
          Values: [instanceName],
        },
        ...STACK_FILTERS,
      ],
    };

    const describeInstancesResponse = await ec2Client.send(
      new DescribeInstancesCommand(describeParams)
    );

    if (describeInstancesResponse.Reservations.length > 0) {
      const instanceDetails =
        describeInstancesResponse.Reservations[0].Instances[0];

      const terminateParams = {
        InstanceIds: [instanceDetails.InstanceId],
      };
      const terminateCommand = new TerminateInstancesCommand(terminateParams);
      await ec2NoRetryClient.send(terminateCommand);
      logger.info(`✅ Instance terminated: ${instanceDetails.InstanceId}`);
      return instanceDetails;
    } else {
      logger.warn("No instances found with the specified name.");
    }
  } catch (error) {
    logger.error(`Error terminating instance: ${error}`);
  }
}

async function createAndWaitForInstance(inputs) {
  const { logger } = inputs;
  let { instance, error } = await createEC2Instance(inputs);

  if (instance) {
    logger.info(
      `→ Waiting for instance ${instance.InstanceId} to be in running state...`
    );
    try {
      await waitUntilInstanceRunning(
        { client: ec2Client, maxWaitTime: 300 },
        { InstanceIds: [instance.InstanceId] }
      );
      logger.info(`✅ EC2 Instance ${instance.InstanceId} is now running.`);
      const instanceDetails = await fetchInstanceDetails(instance.InstanceId);
      return { instance: instanceDetails, error: null };
    } catch (error) {
      error = error;
    }
  }

  return { instance, error };
}

module.exports = {
  findCustomImage,
  createAndWaitForInstance,
  terminateInstance,
  findInstanceTypesMatching,
  instanceTypeFilters,
  generateLaunchTemplate,
};
