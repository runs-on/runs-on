# RunsOn: 10x cheaper GitHub Action runners.

On-demand, self-hosted runners, for your GitHub Action workflows.

Any size, at the cheapest price available.

Runs in your own AWS account.

Quick overview:

- Each workflow job triggers a fresh new runner (i.e. ephemeral).
- Access to all Linux runner types available on AWS. Even bare-metal.
- Supports x64 and arm64 images. You can even bring your own AMIs!
- 1-1 workflow compatibility with official GitHub runners.
- Scales with your needs: you can launch as many workflows in parallel as needed. No concurrency limit.
- SSH access into the runners if needed.
- 🆕 in v1.6.1: local S3 cache for greater speed with `runs-on/cache` action, and UNLIMITED cache sizes.
- 🆕 in v2.1.0: much better concurrency control, thanks to the switch to a more efficient runner pooling algorithm.

```diff
- runs-on: ubuntu-latest
+ runs-on: runs-on,runner=16cpu-linux-x64
```

<img width="675" alt="RunsOn is the fastest and cheapest GitHub Action self-hosted runner alternative" src="https://github.com/runs-on/runs-on/assets/6114/92933f39-c173-4afd-ae43-cc7532f82f77">

## Prices

At least 2x cheaper than SaaS offerings, up to 10x cheaper than GitHub hosted runners. And the [largest choice of configs](https://instances.vantage.sh) ever. All in infrastructure that you control.

The crazy thing is that even if you use larger instance types (e.g. 16cpu) for your workflows, it might actually be cheaper than using a 2cpu instance since your workflow _should_ finish much more quickly (assuming you can take advantage of the higher core number).

→ Use the [GitHub Action pricing calculator](https://runs-on.com/calculator/) to get an idea of the savings.

## Documentation

→ [Read the RunsOn docs](https://runs-on.com/docs/) for all the details.

## License

This software is licensed under the [Prosperity Public License 3.0.0](https://prosperitylicense.com). In practice:

- Free to use if you are a non-profit or for personal use.

- For commercial organizations, you can evaluate for free for 15 days, after which you must buy a license.

Starting with v2.1, only the cloudformation template and the base AMIs are public. With a Sponsorship license, you get access to the source code.

RunsOn has an insane ROI for commercial organizations. Monthly license cost is usually recouped within a few days at most.

→ [Learn more about licensing](https://runs-on.com/pricing/).

## Author

This software is built by [Cyril Rohr](https://cyrilrohr.com) - [Twitter/X](https://twitter.com/crohr).

If you like DevOps tooling, you might also be interested in my other projects [PullPreview.com](https://pullpreview.com) and [Packager.io](https://packager.io).
