# Warm pools for faster boots

- Current instances take about 30s from webhook received until job starting.
- Most of the time is spent launching the VM, pulling the EBS blocks, warming up.
- Some users want faster boot times for smaller jobs and/or a better developer experience.

## How it works

A pool manager regularly (every 30s) fetches the pool configuration from `.github-private` repo config file (that is: `.github-private/.github/runs-on.yml`). The following new configuration is supported:

```yaml
runners:
  small-x64:
    image: ubuntu24-full-x64
    ram: 1
    family: [t3]

pools:
  small-x64:
    runner: small-x64
    timezone: "Europe/Paris"
    schedule:
      - name: default
        stopped: 2
        hot: 1
      - name: nights
        match:
          day: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
          time: ["22:00", "06:00"]
        stopped: 2
        hot: 0
      - name: weekends
        match:
          day: ["saturday", "sunday"]
        stopped: 1
        hot: 0
```

The pool manager will take care of spawning instances according to the matched schedule.

There are two types of pools: `hot`, and `stopped`.

* `hot` instances are spawned by the pool and will stay running for up to 10 minutes to wait for a matching job. If no job comes in during that time, they will get terminated, and a new one will re-spawn. This is to ensure they are kept up to date with latest AMI definition, and also to ensure they can't stay too long online. You can expect <10s job queue time if a hot instance can be picked.

* `stopped` instances are spawned by the pool, will warm the EBS volume and perform various tasks (preinstall, setup mountpoints, efs, etc.), and then will be stopped to avoid high costs. When a matching job comes in, the instance will be picked up and started. Timings are around 20s, and will probably be more stable than with cold-started instances.

Note that if there are no capacity left in a pool, a new instance is automatically cold-started.

## Pool targetting

Jobs can add the `pool=POOL_NAME` label to the `runs-on:` definition, so that they can be matched to an instance in the pool. If POOL_NAME doesn't exist, the job will fail. All other labels except `env` and `region` will be ignored.

## Limitations

* If SSH is enabled for the instances in the pool, only the stack default admins will be added to the instance.
* Instances from a pool are always launched as `on-demand` for now. Support for `spot` for the `hot` pool is theoretically possible and will be added once pools are stable.
