- 2026-10-26 — ADR-0054 PR 3, the overlap rollout: `infra/aws/ecs.tf` moves to 100% / 200% (the new task turns healthy
  before the old stops), with a check in `ecs.tftest.hcl`; the AWS runbook's Deploy section, `infra/aws/README.md` and
  ADR-0049 D5's outage line say so. Opened as a draft: building it found that each task's in-memory server directory
  is loaded once at startup, so a server write served by the old task during the overlap would be missing from the new
  task until its next restart. That needs a fix deployed first.
