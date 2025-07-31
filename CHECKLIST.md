# Release checklist

- [ ] No dangling commits
- [ ] `make bump` doesn't add any changes
- [ ] Deployed latest version to dev (`make dev-install`)
- [ ] Launched concurrency test
- [ ] Deployed latest version to stage (`make stage-install`)
- [ ] Launched main tests from runs-on/runs-on repo, `environment=production`
- [ ] Deployed latest version to test (`make test-install-embedded`) and performed smoke test (`make test-smoke`)

## Release

1. Merge PRs
2. `make pristine`
2. `make stage`
3. `make tag`
4. `make release`