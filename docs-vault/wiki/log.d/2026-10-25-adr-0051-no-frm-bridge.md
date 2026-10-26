- 2026-10-25 — ADR-0051 §2, owner's decisions:
  - FRM's code is never used (clean room);
  - FRM's API is fine as an interim, and FRM may be a required dependency until native parity;
  - removing the dependency starts now: the mod will read everything the dashboard uses with its own code;
  - a similarity check runs before release;
  - the plan is ADR-0058.

  FRM still states no licence (re-checked today).
