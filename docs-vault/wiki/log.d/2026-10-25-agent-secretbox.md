## 2026-10-25 - agent: a platform-neutral secret store and STATE_DIRECTORY (ADR-0057 Decision 2 steps 2-3, Decision 3)

- `agent/src/secretbox.ts`: the `Dpapi` interface is now `SecretBox` (same `protect`/`unprotect`, so `AgentStore` is unchanged); DPAPI stays the Windows implementation.
- New `fileSecretBox` for other platforms: the state directory is created or tightened to 0700, `store.json` is written 0600 atomically (exclusive temp file, fsync, rename), and the agent refuses to read a store file that is looser than 0600, a symlink, not a regular file or owned by another user (checked on the open descriptor with `O_NOFOLLOW`). The error names the path and a `chmod 600` hint and carries no secret.
- Selection by platform (`win32` = DPAPI, else file); `SD_AGENT_SECRET_STORE=dpapi|file` overrides, anything else is a startup error.
- `resolveDataDir` honours `STATE_DIRECTORY` (first entry of a colon list) after `SD_AGENT_HOME` and `LOCALAPPDATA`, before the home folder; Windows is unchanged.
- `agent/CLAUDE.md` and the root `CLAUDE.md` agent line: secrets live in the platform's store. No systemd unit, packaging or self-update is added.
