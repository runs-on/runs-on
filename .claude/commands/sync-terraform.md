---
description: Port CloudFormation changes to Terraform module
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Sync CloudFormation to Terraform

Port changes from `cloudformation/template.yaml` and `cloudformation/dashboard/template.yaml` to the Terraform module in `terraform/`.

## Process

1. **Get the diff** between the current branch and main for the CloudFormation templates:
   ```bash
   git diff main...HEAD -- cloudformation/template.yaml
   git diff main...HEAD -- cloudformation/dashboard/template.yaml
   ```

2. **Analyze the changes** - identify what resources, parameters, or outputs were added, modified, or removed.

3. **Read the relevant Terraform files** to understand the current state:
   - `terraform/main.tf` - module orchestration
   - `terraform/variables.tf` - input variables
   - `terraform/outputs.tf` - output values
   - `terraform/modules/*/` - submodules (core, compute, storage, optional)

4. **Port the changes** to the appropriate Terraform files:
   - New Parameters → `terraform/variables.tf`
   - New Resources → appropriate module in `terraform/modules/`
   - New Outputs → `terraform/outputs.tf`
   - Modified resources → update corresponding Terraform resources

5. **Validate the changes**:
   ```bash
   cd terraform && make init && make quick
   ```
   This runs format check, validation, and linting.

## Module Mapping

| CloudFormation Section | Terraform Location |
|----------------------|-------------------|
| Parameters | `variables.tf` |
| S3 Buckets | `modules/storage/` |
| IAM Roles/Policies | `modules/compute/` |
| Launch Templates | `modules/compute/` |
| App Runner | `modules/core/` |
| SQS Queues | `modules/core/` |
| DynamoDB Tables | `modules/core/` |
| SNS Topics | `modules/core/` |
| EventBridge | `modules/core/` |
| EFS | `modules/optional/` |
| ECR | `modules/optional/` |
| CloudWatch Dashboard | `modules/core/` |
| Outputs | `outputs.tf` |

## Version Sync

Always check the `Mappings.App.Tags` section in `cloudformation/template.yaml` and update the default values in `terraform/variables.tf` to match:

| CloudFormation Mapping | Terraform Variable |
|----------------------|-------------------|
| `Mappings.App.Tags.AppTag` | `variable "app_tag" { default = "..." }` |
| `Mappings.App.Tags.ImageTag` | `variable "app_image" { default = "public.ecr.aws/c5h5o9k1/runs-on/runs-on:..." }` |
| `Mappings.App.Tags.BootstrapTag` | `variable "bootstrap_tag" { default = "..." }` |

For `app_image`, use the full image reference including the SHA256 digest (e.g., `v2.11.0@sha256:...`).

## Notes

- Preserve Terraform naming conventions (snake_case for variables)
- Ensure variables have proper descriptions and validations
- Update module dependencies if new resources require cross-module references
- If no changes are detected in the CloudFormation template, report that no sync is needed
