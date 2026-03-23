---
name: Terraform Review
description: Deep review of Terraform/OpenTofu configuration — state management, module design, security hardening, drift prevention, and production safety patterns.
version: 2026.3.1
license: MIT
triggers:
  lenses:
    - security
    - logic
  keywords:
    - terraform
    - opentofu
    - hcl
    - infrastructure
    - iac
    - aws
    - cloud
---

When reviewing Terraform configuration, apply the following checks.

## State Management

Verify state is stored in a remote backend (S3, GCS, Azure Blob, Terraform Cloud) — never local. Flag `terraform.tfstate` committed to the repository. Check that state locking is enabled (DynamoDB for S3 backend, native for Terraform Cloud) to prevent concurrent modifications.

Flag state files that contain secrets in plaintext — use `sensitive = true` on outputs and variables that contain credentials. Verify state backend configuration uses encryption at rest. Flag shared state buckets without versioning — state corruption without version history is unrecoverable.

## Security

Flag IAM policies with `"Action": "*"` or `"Resource": "*"` — use least-privilege permissions. Verify security groups do not allow `0.0.0.0/0` ingress on sensitive ports (SSH/22, RDP/3389, database ports). Flag S3 buckets without `block_public_access` enabled.

Check that secrets are not hardcoded in `.tf` files — use variables with `sensitive = true` sourced from a secrets manager or environment variables. Flag `default` values on sensitive variables — these persist in state and plan output.

Verify encryption is enabled for all storage resources (S3, EBS, RDS, DynamoDB). Flag resources created without tags — tags are essential for cost allocation, ownership tracking, and automated cleanup.

## Module Design

Flag modules with more than 20 input variables — break into smaller, focused modules. Verify module outputs expose only what consumers need — not internal resource IDs that create tight coupling. Check that modules use version constraints when sourced from registries (`version = "~> 3.0"`).

Flag modules that use `count` for complex conditional logic — use `for_each` with a map for clarity. Verify lifecycle meta-arguments (`prevent_destroy`, `ignore_changes`) are justified with comments.

## Resource Patterns

Flag resources without `lifecycle.prevent_destroy` on critical infrastructure (databases, encryption keys, DNS zones). Verify `create_before_destroy` is set on resources where downtime during replacement is unacceptable (load balancers, DNS records).

Check that `ignore_changes` is not used to mask drift from manual changes — it should only be used for fields managed by external processes (auto-scaling counts, tags set by external tools). Flag `ignore_changes = all` — this makes the resource unmanaged.

## Plan Safety

Verify destructive operations (resource deletion, replacement) are expected before applying. Flag plans that destroy resources which were not explicitly targeted. Check that `moved` blocks are used for resource renames instead of destroy-and-recreate.

Flag `terraform apply -auto-approve` in production pipelines without a preceding `terraform plan` output review. Verify that plan output is saved to a file and the saved plan is what gets applied.

## Provider Configuration

Flag provider versions without constraints — pin to a specific minor version range (`~> 5.0`). Verify provider authentication uses IAM roles or workload identity, not long-lived access keys. Flag multiple providers of the same type without explicit aliases.

## Data Sources

Flag `data` sources used to look up resources that should be managed by Terraform — if Terraform created it, reference it directly. Verify data sources handle the case where the external resource does not exist (especially during initial apply).

For each finding, report: the resource or module, the specific Terraform pattern violated, and the recommended fix.
