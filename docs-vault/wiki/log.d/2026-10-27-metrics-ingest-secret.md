- 2026-10-27 — ADR-0056 PR 6c (#281): `infra/aws` names the delivery ingest's hash. `METRICS_INGEST_SECRET_SHA256` is a
  new `/satis/prod/` name in `ssm.tf` and a new optional backend secret in `ecs.tf`, so it is injected (and the
  execution role may read it) only once the owner lists it in `backend_optional_secrets`. As with every other
  `/satis/prod/` value, Terraform only names it: the owner puts the hex SHA-256 in by hand as a SecureString, and it is
  never in code or state. Merging changes nothing in AWS and does not block deploys (the deploy guard checks the base's
  family, role, containers and cloudflared pin, none of which change); the ingest turns on after the owner's put,
  tfvars opt-in, `terraform apply` and a Deploy `redeploy`. Two `terraform test` runs cover opt-in and the default.
