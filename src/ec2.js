const { EC2Client, paginateDescribeInstanceTypes } = require("@aws-sdk/client-ec2");
const { defaultProvider } = require("@aws-sdk/credential-provider-node");
const { DescribeInstancesCommand, DescribeInstanceStatusCommand, DescribeImagesCommand, RunInstancesCommand, waitUntilInstanceRunning, TerminateInstancesCommand } = require("@aws-sdk/client-ec2");

const {
  DEFAULT_ARCHITECTURE,
  DEFAULT_PLATFORM,
  DEFAULT_CPU,
  DEFAULT_HDD,
  DEFAULT_IOPS,
  USER_DATA,
  STACK_TAGS,
  SUPPORTED_ARCHITECTURES,
  STACK_FILTERS,
  DEFAULT_USER,
  DEFAULT_FAMILY_FOR_PLATFORM
} = require("./constants");

const { isStringFloat } = require("./utils");

let ec2Client;
let region;
let app;

async function init(probotApp) {
  app = probotApp;
  const credentials = await defaultProvider();
  ec2Client = new EC2Client({ credentials });
  region = await ec2Client.config.region();
  app.log.info(`✅ EC2 client initialized for region ${region}`);
  app.state.custom.region = region;
  return app;
}

function extractInfosFromImage(image) {
  return {
    ami: image.ImageId,
    platform: image.PlatformDetails,
    name: image.Name,
    arch: image.Architecture,
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
  // Try each instance type until one is successfully created
  for (const instanceType of instanceTypes) {
    // make sure we're using a duplicate of the instance params since we're modifying it
    let instanceParamsForType = { ...instanceParams };
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
        return null;
      } else {
        const instanceResponse = await ec2Client.send(runCommand);
        const instance = instanceResponse.Instances[0];
        app.log.info(`✅ EC2 Instance created with ID: ${instance.InstanceId} and type ${instanceType.InstanceType}`);
        return instance;
      }
    } catch (error) {
      app.log.warn(`⚠️ Failed to create instance with type ${instanceType.InstanceType}: ${error}.`);
    }
  }
  return null;
}

function flatMapInput(input) {
  return [input].flat().filter(i => i).map(n => String(n).split("+")).flat().filter(i => i);
}

// TODO: store instance types in cache for at least 1 hour
async function findInstanceTypesMatching(inputs) {
  const { arch, platform, cpu, ram, family } = inputs;

  const familyValues = flatMapInput(family);
  const cpuValues = flatMapInput(cpu).map(i => Number(i));
  const ramValues = flatMapInput(ram).map(i => Number(i) * 1024);

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
  if (families.length <= 0) {
    families.push(DEFAULT_FAMILY_FOR_PLATFORM[platform]);
    params.Filters.push({
      Name: "current-generation",
      Values: ["true"],
    });
  }
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

  matchingInstanceTypes.sort((a, b) => {
    const familyAIndex = familyValues.indexOf(a.InstanceType.split(".")[0]);
    const familyBIndex = familyValues.indexOf(b.InstanceType.split(".")[0]);
    const familyIndexComparison = familyAIndex - familyBIndex;

    if (familyIndexComparison !== 0) {
      return familyIndexComparison;
    }

    // Sort by vCPUs ascending
    return a.VCpuInfo.DefaultVCpus - b.VCpuInfo.DefaultVCpus;
  }).sort((a, b) => {
    if (families[0] === "c*") {
      // sort by family descending
      return b.InstanceType.split(".")[0].localeCompare(a.InstanceType.split(".")[0]);
    }
  });

  const selectedInstanceTypes = matchingInstanceTypes.slice(0, 5);
  app.log.info(`Selected instance types: ${JSON.stringify(selectedInstanceTypes.map(instanceType => instanceType.InstanceType))}`);

  if (selectedInstanceTypes.length === 0) {
    throw new Error(`❌ No instance types found matching the provided criteria: ${JSON.stringify({ ...inputs, region })}`);
  }

  return selectedInstanceTypes;
}

function base64Scripts(scripts = []) {
  return Array(scripts).flat().filter(i => i).map(script => Buffer.from(script).toString('base64'));
}

async function createEC2Instance({
  dryRun = false,
  tags = [],
  spot,
  imageSpec,
  runnerSpec,
  instanceName,
  userDataConfig
}) {
  const { subnetId, securityGroupId } = app.state.custom;
  const { cpu = DEFAULT_CPU, ram, iops = DEFAULT_IOPS, hdd = DEFAULT_HDD, family = "c" } = runnerSpec;
  const storageType = iops && parseInt(iops) > 0 ? "io2" : "gp3";

  app.log.info(`Attempting to find image for ${JSON.stringify(imageSpec)}...`);
  const finalImageSpec = await findCustomImage(imageSpec);
  const { ami, arch, platform, user = DEFAULT_USER, preinstall = [] } = finalImageSpec;

  // at this point, arch and platform are named after the AWS specific names (e.g. x86_64, Linux/UNIX)
  app.log.info(`✅ Found AMI: ${JSON.stringify(finalImageSpec)}`);

  const userDataTemplate = USER_DATA[platform];
  if (!userDataTemplate) {
    throw new Error(`❌ No user data template found for platform ${platform}`);
  }

  const instanceTypes = await findInstanceTypesMatching({ arch, platform, cpu, ram, family })
  const userData = userDataTemplate({
    ...userDataConfig,
    arch,
    runnerUser: user,
    preinstallScripts: base64Scripts(preinstall),
  });

  console.log("userData", userData);

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
        VolumeSize: String(hdd), // Size of the root EBS volume in GB
        VolumeType: String(storageType),
      },
      TagSpecifications: [{ ResourceType: 'volume', Tags: [...STACK_TAGS, ...tags] }]
    }]
  };

  if (["io2", "io1"].includes(storageType) && iops > 0) {
    instanceParams.BlockDeviceMappings[0].Ebs.Iops = String(iops);
  }

  if (spot) {
    app.log.info(`→ Using spot instances`);
    instanceParams.InstanceMarketOptions = {
      MarketType: 'spot',
      SpotOptions: {
        // max price per hour, but will use the min availabe price at the time of request
        // can set spot=PRICE to use a specific price
        MaxPrice: isStringFloat(spot) ? spot : "2.0",
        SpotInstanceType: 'one-time',
        InstanceInterruptionBehavior: 'terminate'
      }
    }
  }

  let instance = await createSingleEC2Instance({ tags, instanceTypes, instanceParams, dryRun });

  if (!instance && spot) {
    // attempt one last time without spot instances
    app.log.info(`→ Attempting to create instance without spot instances...`);
    delete instanceParams.InstanceMarketOptions;
    instance = await createSingleEC2Instance({ tags, instanceTypes, instanceParams, dryRun });
  }

  if (instance) {
    return instance;
  } else {
    throw new Error("❌ Failed to create instance with any of the provided instance types");
  }
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
      const instanceId = describeInstancesResponse.Reservations[0].Instances[0].InstanceId;

      const terminateParams = {
        InstanceIds: [instanceId],
      };

      await ec2Client.send(new TerminateInstancesCommand(terminateParams));
      app.log.info(`✅ Instance terminated: ${instanceId}`);
    } else {
      app.log.warn('No instances found with the specified name.');
    }
  } catch (error) {
    app.log.error(`Error terminating instance: ${error}`);
  }
}

module.exports = { init, region, createEC2Instance, terminateInstance, fetchInstanceDetails, waitForInstance }