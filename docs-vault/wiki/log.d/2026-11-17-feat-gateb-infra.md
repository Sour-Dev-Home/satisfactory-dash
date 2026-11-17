- **Gate B PR 5: the AWS task no longer injects the password login's secrets** (#186).
  - `infra/aws` no longer names `DASHBOARD_ADMIN_PASSWORD_HASH` or `SESSION_SECRET`: `ssm.tf`, the production
    backend's required secrets (`ecs.tf`), and staging's keys and backend secrets (`staging.tf`). The backend stopped
    reading both in #899. `DASHBOARD_ADMIN_USER` stays: it is the operator account's display name.
  - The sign-in failure alarm's filter drops `login failed`, a line nothing logs since #899.
  - The Terraform tests (61 pass), the static infra test, the infra README and the aws and compose runbooks match.
  - **Owner:** this changes AWS only after `terraform apply` in `infra/aws`. The deploy guard doesn't compare
    secrets, so deploys keep working before and after. After the apply, the four SSM parameters
    `/satis/{prod,staging}/{DASHBOARD_ADMIN_PASSWORD_HASH,SESSION_SECRET}` are unused and can be deleted.
