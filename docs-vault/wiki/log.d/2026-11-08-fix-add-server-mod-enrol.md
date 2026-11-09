- **Add your server, for the mod as it is (owner, 2026-11-08: "finish the add your server and turn it on in production").** The
  mod (0.2.0 and the 0.3.0 candidate) enrols only with an enrolment code in `SatisDashAgent.cfg`; it has no device-code pairing
  (confirmed by the mod session from the mod's source). So "Add your server" no longer links "Pair it", and the two guides
  (`getting-started`, `connecting-a-server`) drop the pairing steps, which promised a console code and `pairing.txt` that don't
  exist. The `/app/pair` page and the pairing API stay, unlinked, for a mod that pairs later. `COMPAT_POLICY.mod.current` is now
  `0.2.0`, the mod's latest release (it said `0.1.0`, from before any release). Production's `SELF_SERVE_ENABLED=true` is set in
  the owner's Terraform variables, outside the repo; it takes effect on the owner's apply and redeploy.
