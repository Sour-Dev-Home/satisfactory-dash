---
area: general
pattern: untargeted-apply-reverts-manual-state
severity: important
reviewer: test-hunter
source: "#426"
---

When a runbook changes live state by hand (scaling an ECS service to 0 with the CLI) and a later step runs `terraform apply`, check what the configuration declares for that state: `ecs.tf` sets `desired_count = 1` with no `ignore_changes`, so an untargeted apply in the middle of the RDS reset would have scaled the backend back up onto an empty database. Target every apply that runs while hand-made state must hold, and say why next to the command.
