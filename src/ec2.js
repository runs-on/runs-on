const {
  EC2Client,
  DescribeInstancesCommand,
  DescribeImagesCommand,
  CreateFleetCommand,
  TerminateInstancesCommand,
} = require("@aws-sdk/client-ec2");
const memoize = require("lru-memoize").default;
const stack = require("./stack").getInstance();

const {
  DEFAULT_ARCHITECTURE,
  DEFAULT_PLATFORM,
  STACK_TAGS,
  SUPPORTED_ARCHITECTURES,
  STACK_FILTERS,
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
    mainDiskSize: image.BlockDeviceMappings[0].Ebs.VolumeSize,
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

const createEC2Fleet = async function ({
  launchTemplateId,
  imageId,
  rams,
  cpus,
  families,
  subnets,
  spot,
  tags = [],
}) {
  const memoryRequirements = { Min: 0 };
  const cpuRequirements = { Min: 0 };
  const familyRequirements = [];
  if (rams.length > 0) {
    memoryRequirements.Min = Math.min(rams);
    memoryRequirements.Max = Math.max(rams);
  }
  if (cpus.length > 0) {
    cpuRequirements.Min = Math.min(cpus);
    cpuRequirements.Max = Math.max(cpus);
  }
  families.forEach((family) => {
    if (family.includes("*") || family.includes(".")) {
      familyRequirements.push(family);
    } else {
      familyRequirements.push(`${family}*`);
    }
  });
  const fleetParams = {
    TagSpecifications: [
      {
        ResourceType: "instance",
        Tags: [...tags, ...STACK_TAGS],
      },
    ],
    LaunchTemplateConfigs: [
      {
        LaunchTemplateSpecification: {
          LaunchTemplateId: launchTemplateId,
          Version: "$Latest",
        },
        Overrides: subnets.map((subnet, i) => {
          return {
            SubnetId: subnet,
            InstanceRequirements: {
              MemoryMiB: memoryRequirements,
              VCpuCount: cpuRequirements,
              AllowedInstanceTypes: familyRequirements,
            },
            ImageId: imageId,
          };
        }),
      },
    ],
    SpotOptionsRequest: {
      AllocationStrategy: "capacity-optimized-prioritized",
      InstanceInterruptionBehavior: "terminate",
    },
    OnDemandOptionsRequest: {
      AllocationStrategy: "prioritized",
    },
    TargetCapacitySpecification: {
      TotalTargetCapacity: 1,
      DefaultTargetCapacityType: spot ? "spot" : "on-demand",
    },
    Type: "instant",
  };

  logger.info(`EC2 Fleet parameters: ${JSON.stringify(fleetParams)}`);

  const createFleetCommand = new CreateFleetCommand(fleetParams);
  await stack.ec2RateLimiterRunInstances.waitForToken();
  const fleetData = await ec2NoRetryClient.send(createFleetCommand);

  return fleetData;
};

async function terminateInstance(runnerName) {
  let describeParams = {};
  let instanceId;
  // new since v1.7.5, instance id is contained in runner name
  if (runnerName.startsWith("runs-on--")) {
    instanceId = runnerName.split("--")[1];
    describeParams.InstanceIds = [instanceId];
  } else {
    // legacy: find instance from instance tag Name
    describeParams.Filters = [
      {
        Name: "tag:Name",
        Values: [runnerName],
      },
      ...STACK_FILTERS,
    ];
  }

  const describeInstancesResponse = await ec2Client.send(
    new DescribeInstancesCommand(describeParams)
  );

  if (describeInstancesResponse.Reservations.length > 0) {
    const instanceDetails =
      describeInstancesResponse.Reservations[0].Instances[0];
    instanceId = instanceDetails.InstanceId;

    const terminateCommand = new TerminateInstancesCommand({
      InstanceIds: [instanceId],
    });

    await stack.ec2RateLimiterTerminateInstances.waitForToken();
    await ec2NoRetryClient.send(terminateCommand);
    return instanceDetails;
  } else {
    return;
  }
}

module.exports = {
  findCustomImage,
  terminateInstance,
  createEC2Fleet,
};
