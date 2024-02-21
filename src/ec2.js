const { EC2Client, paginateDescribeInstanceTypes } = require("@aws-sdk/client-ec2");
const { DescribeInstancesCommand, DescribeInstanceStatusCommand, DescribeImagesCommand, RunInstancesCommand, waitUntilInstanceRunning, TerminateInstancesCommand } = require("@aws-sdk/client-ec2");
const memoize = require('lru-memoize').default;
const pThrottle = require('p-throttle');

const costs = require("./costs");
const {
  EC2_RUN_INSTANCE_CONCURRENCY,
  DEFAULT_ARCHITECTURE,
  DEFAULT_PLATFORM,
  DEFAULT_CPU,
  DEFAULT_IOPS,
  USER_DATA,
  STACK_TAGS,
  SUPPORTED_ARCHITECTURES,
  STACK_FILTERS,
  DEFAULT_FAMILY_FOR_PLATFORM,
  DEFAULT_THROUGHPUT,
  STACK_NAME
} = require("./constants");

const ec2Client = new EC2Client();
let region;
let app;

async function init(probotApp) {
  app = probotApp;
  return app;
}

function extractInfosFromImage(image) {
  return {
    ami: image.ImageId,
    platform: image.PlatformDetails,
    name: image.Name,
    arch: image.Architecture,
    minHddSize: image.BlockDeviceMappings[0].Ebs.VolumeSize,
    // make sure we fetch the real owner
    owner: image.OwnerId,
  }
}

async function findCustomImage(inputs) {
  const { ami, arch = DEFAULT_ARCHITECTURE, platform = DEFAULT_PLATFORM, name, owner } = inputs;

  const params = ami ? { ImageIds: [String(ami)] } : {
    Filters: [
      { Name: "name", Values: [String(name)] },
      { Name: "architecture", Values: [String(SUPPORTED_ARCHITECTURES[arch] || arch)] },
      { Name: "state", Values: ["available"] },
    ],
    Owners: [String(owner)]
  }

  // according to AWS docs, the platform can only have the value of windows
  if (platform === 'windows') {
    params.Filters.push({ Name: "platform", Values: ["windows"] })
  }

  const response = await ec2Client.send(new DescribeImagesCommand(params));
  if (response.Images.length === 0) {
    throw new Error(`❌ No AMIs found for ${JSON.stringify({ ...inputs, region })}`);
  }
  // Sort to find the most recent one
  response.Images.sort((a, b) => b.Name.localeCompare(a.Name));

  return { ...inputs, region, ...extractInfosFromImage(response.Images[0]) };
}

async function createSingleEC2Instance({ tags = [], instanceTypes, instanceParams, dryRun }) {
  let error;
  let instance;
  // Try each instance type until one is successfully created
  for (const instanceType of instanceTypes) {
    // make sure we're using a duplicate of the instance params since we're modifying it
    let instanceParamsForType = { ...instanceParams };

    // set cpucredits to unlimited for burstable instances, even though this can cost more in the end that the equivalent non-burstable instance.
    // in the long run, users will choose whether their workload is better with burstable or non-burstable family types
    // https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode.html
    // https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode-concepts.html
    if (instanceType.InstanceType.startsWith("t")) {
      instanceParamsForType.CreditSpecification = {
        CpuCredits: "unlimited"
      }
    }

    if (instanceType.InstanceStorageSupported) {
      instanceParamsForType.BlockDeviceMappings = [
        {
          DeviceName: '/dev/sdb', // Device name for the instance store volume
          VirtualName: 'ephemeral0', // Name used internally by AWS for the instance store volume,
          TagSpecifications: [{ ResourceType: 'volume', Tags: [...STACK_TAGS, ...tags] }]
        },
        ...instanceParamsForType.BlockDeviceMappings
      ]
    }

    try {
      app.log.info(`→ Attempting to create instance with type ${instanceType.InstanceType}...`);
      instanceParamsForType.InstanceType = instanceType.InstanceType;
      const runCommand = new RunInstancesCommand(instanceParamsForType);
      if (dryRun) {
        app.log.info(`→ Not launching instance since dry-run=true`);
        return { instance, error };
      } else {
        const instanceResponse = await ec2Client.send(runCommand);
        const instance = instanceResponse.Instances[0];
        app.log.info(`✅ EC2 Instance created with ID: ${instance.InstanceId} and type ${instanceType.InstanceType}`);
        return { instance, error };
      }
    } catch (error) {
      error = app.log.warn(`⚠️ Failed to create instance with type ${instanceType.InstanceType}: ${error}.`);
    }
  }
  return { instance, error };
}

function flatMapInput(input) {
  return [input].flat().filter(i => i).map(n => String(n).split("+")).flat().filter(i => i);
}

const _findInstanceTypesMatching = async function (inputs) {
  const { arch = DEFAULT_ARCHITECTURE, platform = DEFAULT_PLATFORM, cpu = DEFAULT_CPU, ram, family } = inputs;

  let familyValues = flatMapInput(family);
  const cpuValues = flatMapInput(cpu).map(i => Number(i));
  const ramValues = flatMapInput(ram).map(i => Number(i) * 1024);

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
  const params = {
    Filters: [
      {
        //  The supported architecture (i386 | x86_64 | arm64 ).
        Name: "processor-info.supported-architecture",
        Values: [`${SUPPORTED_ARCHITECTURES[arch] || arch}`],
      },
      {
        Name: "supported-usage-class",
        Values: ["on-demand", "spot"]
      },
      {
        Name: "bare-metal",
        Values: ["false"]
      }
    ],
  };
  // if (families.length <= 0) {
  //   params.Filters.push({
  //     Name: "current-generation",
  //     Values: ["true"],
  //   });
  // }
  params.Filters.push({
    Name: "instance-type",
    Values: families,
  });
  if (cpuValues.length > 0) {
    params.Filters.push({
      Name: "vcpu-info.default-vcpus",
      Values: cpuValues,
    });
  }
  if (ramValues.length > 0) {
    params.Filters.push({
      Name: "memory-info.size-in-mib",
      Values: ramValues,
    });
  }
  app.log.info(`Instance search filters: ${JSON.stringify(params.Filters)}`)

  let matchingInstanceTypes = []
  let totalPages = 0;

  const paginator = paginateDescribeInstanceTypes({ client: ec2Client, pageSize: 100 }, params);
  for await (const page of paginator) {
    // Concatenate the results from each page.
    totalPages += 1;
    matchingInstanceTypes.push(...page.InstanceTypes);
  }

  app.log.info(`Found ${matchingInstanceTypes.length} matching instance types among close to ${totalPages * 100} instance types`);

  // sort by instance type name ascending
  matchingInstanceTypes = matchingInstanceTypes.sort((a, b) => {
    return a.InstanceType.localeCompare(b.InstanceType);
  })

  const matchingInstanceTypesByFamily = matchingInstanceTypes.reduce((acc, instanceType) => {
    const family = instanceType.InstanceType.split(".")[0];
    if (!acc[family]) {
      acc[family] = [];
    }
    acc[family].push(instanceType);
    // sort by vCPU ascending
    acc[family] = acc[family].sort((a, b) => a.VCpuInfo.DefaultVCpus - b.VCpuInfo.DefaultVCpus);
    return acc;
  }, {});

  const sortedMatchingInstanceTypes = new Set();

  for (const family of families) {
    // find matching instances for each family, from matchingInstanceTypesByFamily
    // a family can have a wildcard in its name
    const familyRegex = new RegExp(`^${family.replace("*", ".*")}$`);
    // find groups of instance types that match the family
    Object.entries(matchingInstanceTypesByFamily).filter(([familyName]) => {
      return familyName.match(familyRegex)
    }).forEach(([_, instanceTypes]) => {
      instanceTypes.forEach((instanceType) => {
        sortedMatchingInstanceTypes.add(instanceType);
      })
    });
  }

  const selectedInstanceTypes = [...sortedMatchingInstanceTypes].slice(0, 10);

  app.log.info(`Selected instance types: ${JSON.stringify(selectedInstanceTypes.map(instanceType => instanceType.InstanceType))}`);

  if (selectedInstanceTypes.length === 0) {
    throw new Error(`❌ No instance types found matching the provided criteria: ${JSON.stringify({ ...inputs, region })}`);
  }

  return selectedInstanceTypes;
}

const findInstanceTypesMatching = memoize(40)(_findInstanceTypesMatching);

function base64Scripts(scripts = []) {
  return Array(scripts).flat().filter(i => i).map(script => Buffer.from(script).toString('base64'));
}

// https://docs.aws.amazon.com/AWSEC2/latest/APIReference/throttling.html
const createEC2Instance = async function ({
  dryRun = false,
  tags = [],
  spot,
  imageSpec,
  runnerSpec,
  instanceName,
  userDataConfig
}) {
  const { subnetId, securityGroupId } = app.state.stack.outputs;
  const { cpu, ram,
    iops = DEFAULT_IOPS,
    hdd,
    throughput = DEFAULT_THROUGHPUT,
    family
  } = runnerSpec;

  app.log.info(`Attempting to find image for ${JSON.stringify(imageSpec)}...`);
  const finalImageSpec = await findCustomImage(imageSpec);
  const { ami, arch, owner, platform, minHddSize, preinstall = [] } = finalImageSpec;

  // io2 doesn't bring much improvement, unless you buy more than 10k IOPS, which is expensive
  // so only supporting gp3 for now
  const storageType = "gp3"

  let finalIops = parseInt(iops)
  if (isNaN(finalIops)) {
    finalIops = DEFAULT_IOPS
  }
  // gp3 is 3000 min, so do not accept anything less
  // make sure final iops is not more than 4000, which is max for gp3
  finalIops = Math.min(Math.max(finalIops, 3000), 4000)

  // https://aws.amazon.com/ebs/pricing/?nc1=h_ls
  let finalThroughput = parseInt(throughput)
  if (isNaN(finalThroughput)) {
    finalThroughput = DEFAULT_THROUGHPUT
  }
  // allow reducing throughput from default, but not less than 250 MB/s
  // make sure final throughput is no more than 25% of final IOPS, otherwise AWS will raise an error
  finalThroughput = Math.min(Math.max(finalThroughput, 250), finalIops * 0.25)

  // gp3 storage is $0.08/GB-month, i.e. for 50GB: 50*0.08/(60*24*30)=$0.000092/min
  let finalHdd = parseInt(hdd)
  if (isNaN(finalHdd)) {
    // if no disk size specified, take the AMI size and add 10GB
    finalHdd = minHddSize + 10;
  } else {
    // otherwise, make sure we don't go below the AMI disk size
    finalHdd = Math.max(minHddSize, finalHdd);
  }

  // larger images will get max throughput
  if (minHddSize >= 30) {
    finalThroughput = 1000
    finalIops = 4000
  }

  // at this point, arch and platform are named after the AWS specific names (e.g. x86_64, Linux/UNIX)
  app.log.info(`✅ Found AMI: ${JSON.stringify(finalImageSpec)}`);

  const userDataTemplate = USER_DATA[platform];
  if (!userDataTemplate) {
    throw new Error(`❌ No user data template found for platform ${platform}`);
  }

  const instanceTypes = await findInstanceTypesMatching({ arch, platform, cpu, ram, family })
  const userData = userDataTemplate({
    ...userDataConfig,
    s3BucketCache: app.state.stack.outputs.s3BucketCache,
    awsRegion: app.state.stack.outputs.region,
    launchedAt: (new Date()).toISOString(),
    arch,
    preinstallScripts: base64Scripts(preinstall),
  });

  // Create the instance
  let instanceParams = {
    SubnetId: subnetId,
    SecurityGroupIds: [securityGroupId],
    ImageId: ami,
    MinCount: 1,
    MaxCount: 1,
    TagSpecifications: [{
      ResourceType: 'instance',
      Tags: [{ Key: 'Name', Value: instanceName }, ...STACK_TAGS, ...tags]
    }],
    // Setting this to true, even though most instances don't care - https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-optimized.html
    EbsOptimized: true,
    InstanceInitiatedShutdownBehavior: 'terminate',
    UserData: Buffer.from(userData).toString('base64'),
    BlockDeviceMappings: [{
      DeviceName: '/dev/sda1', // Device name for the root volume
      Ebs: {
        VolumeSize: finalHdd, // Size of the root EBS volume in GB
        VolumeType: String(storageType),
      },
      TagSpecifications: [{ ResourceType: 'volume', Tags: [...STACK_TAGS, ...tags] }]
    }],
    IamInstanceProfile: {
      Arn: app.state.stack.outputs.instanceProfileArn
    }
  };
  // specifiy instance profile:
  // https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html#instance-profiles
  // instanceParams.IamInstanceProfile = {
  //   Arn: app.state.custom.instanceProfileArn
  // }

  // https://aws.amazon.com/ebs/pricing/?nc1=h_ls
  // Throughput costs $0.040/MB/s-month over 125, i.e. for 400MB/s: (400-125)*0.040/(60*24*30)=$0.00025/min
  instanceParams.BlockDeviceMappings[0].Ebs.Throughput = finalThroughput;
  instanceParams.BlockDeviceMappings[0].Ebs.Iops = finalIops;

  app.log.info(`Storage details: ${JSON.stringify(instanceParams.BlockDeviceMappings[0].Ebs)}`)

  if (spot) {
    app.log.info(`→ Using spot instances`);
    instanceParams.InstanceMarketOptions = {
      MarketType: 'spot',
      SpotOptions: {
        // https://docs.aws.amazon.com/whitepapers/latest/cost-optimization-leveraging-ec2-spot-instances/how-spot-instances-work.html
        SpotInstanceType: 'one-time',
        InstanceInterruptionBehavior: 'terminate'
      }
    }
  }

  let result = await createSingleEC2Instance({ tags, instanceTypes, instanceParams, dryRun });

  if (!result.instance && spot) {
    // attempt one last time without spot instances
    app.log.info(`→ Attempting to create instance without spot instances...`);
    delete instanceParams.InstanceMarketOptions;
    result = await createSingleEC2Instance({ tags, instanceTypes, instanceParams, dryRun });
  }

  return result;
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
  const data = await ec2Client.send(describeInstancesCommand)
  const instances = data.Reservations.flatMap((reservation) =>
    reservation.Instances
  );
  if (instances.length > 0) {
    return instances[0];
  } else {
    throw new Error(`❌ No instances found with ID ${instanceId}`);
  }
}
// waitForStatusChecks is false by default, since it takes much longer to say OK vs reality of runner being connected to GitHub
async function waitForInstance(instanceId, waitForStatusChecks = false) {
  app.log.info(`→ Waiting for instance ${instanceId} to be in running state...`);

  try {
    // First, wait until the instance is in a running state
    await waitUntilInstanceRunning({ client: ec2Client, maxWaitTime: 300 }, { InstanceIds: [instanceId] });
    app.log.info(`✅ EC2 Instance is now running.`);

    if (waitForStatusChecks) {
      // Now check the instance status
      let instanceOk = false;
      let attempts = 0;
      const maxAttempts = 30;

      while (!instanceOk) {
        if (attempts > maxAttempts) {
          throw new Error(`❌ Instance ${instanceId} did not pass status checks after 10 attempts.`);
        }
        attempts++;
        const status = await ec2Client.send(new DescribeInstanceStatusCommand({ InstanceIds: [instanceId] }));
        const instanceStatuses = status.InstanceStatuses;

        if (instanceStatuses.length > 0 && instanceStatuses[0].InstanceStatus.Status === 'ok' && instanceStatuses[0].SystemStatus.Status === 'ok') {
          instanceOk = true;
          app.log.info(`Instance ${instanceId} is running and status checks passed.`);
        } else {
          app.log.info(`[${attempts}/${maxAttempts}] Waiting for instance ${instanceId} status checks to pass...`);
          await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for 10 seconds before checking again
        }
      }
    }
  } catch (error) {
    app.log.error(`❌ Error waiting for instance to run and pass status checks: ${error}`);
    throw error;
  }
}

async function terminateInstance(instanceName) {
  try {
    const describeParams = {
      Filters: [
        {
          Name: 'tag:Name',
          Values: [instanceName],
        }, ...STACK_FILTERS
      ],
    };

    const describeInstancesResponse = await ec2Client.send(new DescribeInstancesCommand(describeParams));

    if (describeInstancesResponse.Reservations.length > 0) {
      const instanceDetails = describeInstancesResponse.Reservations[0].Instances[0];

      const terminateParams = {
        InstanceIds: [instanceDetails.InstanceId],
      };

      await ec2Client.send(new TerminateInstancesCommand(terminateParams));
      app.log.info(`✅ Instance terminated: ${instanceDetails.InstanceId}`);
      return instanceDetails;
    } else {
      app.log.warn('No instances found with the specified name.');
    }
  } catch (error) {
    app.log.error(`Error terminating instance: ${error}`);
  }
}

console.log("EC2_RUN_INSTANCE_CONCURRENCY", EC2_RUN_INSTANCE_CONCURRENCY)
const awsRateLimit = pThrottle({ limit: EC2_RUN_INSTANCE_CONCURRENCY, interval: 1000 })

const runQueue = awsRateLimit((inputs) => {
  return createEC2Instance(inputs);
});

async function createAndWaitForInstance(inputs) {
  const { instance, error } = await runQueue(inputs);
  if (instance) {
    await waitForInstance(instance.InstanceId);
    const instanceDetails = await fetchInstanceDetails(instance.InstanceId);
    app.log.info(`✅ Instance is running: ${JSON.stringify(instanceDetails)}`);
    return instanceDetails;
  } else {
    const msg = `Unable to start EC2 instance with the following configuration: ${JSON.stringify({ imageSpec, runnerSpec })}: ${error}`;
    throw new Error(msg);
  }
}

const terminateQueue = awsRateLimit((instanceName) => {
  return terminateInstance(instanceName);
});


const metricsQueue = awsRateLimit((inputs) => {
  return costs.postWorkflowUsage(inputs);
});

async function terminateInstanceAndPostCosts(instanceName) {
  const instanceDetails = await terminateQueue(instanceName)
  if (instanceDetails) {
    app.log.info(JSON.stringify(instanceDetails))
    await metricsQueue({ ...instanceDetails, AssumedTerminationTime: new Date() });
  }
}

module.exports = { init, region, createAndWaitForInstance, terminateInstanceAndPostCosts, findInstanceTypesMatching }