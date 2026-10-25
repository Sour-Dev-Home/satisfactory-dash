# Runbook: the Linux agent, install and verify (ADR-0057 Decision 2 step 5, Decision 7)

Two ways to run the agent on Linux, both from one tag `agent-vX.Y.Z` (cut by the owner; nothing publishes without it):

- **Tarball** with `agent.cjs`, the systemd unit (`agent/packaging/linux/satis-agent.service`) and `install.sh`. For a game
  host you control.
- **Container image** `ghcr.io/sour-dev-home/satisfactory-dash-agent` for linux/amd64 and linux/arm64. arm64 is for a
  relay Pi only: the game itself has no ARM build (ADR-0057, `raw-sources/linux-server-docker-pterodactyl-2026-10-25.md`).

**The agent never updates itself, and neither should anything you run it with.** You update on purpose: verify the new
release (below), then replace the files or the image digest and restart the agent service only (the game keeps running; the
agent is a separate process). There is no `latest` image tag, and do not run Watchtower or any
auto-pull tool on this image. Pin by digest. Run the node that `install.sh` checked from a root-owned location (for example
`/usr/bin/node`), not one under a home directory (nvm): the service must not execute code a user can rewrite.

## What is signed, and how to check it

Signing is keyless Sigstore through this repo's release workflow (`.github/workflows/agent-release.yml`): there is no private
key to steal or lose. You verify against the workflow's identity, which is
`https://github.com/Sour-Dev-Home/satisfactory-dash/.github/workflows/agent-release.yml@refs/tags/agent-vX.Y.Z`,
issued by `https://token.actions.githubusercontent.com`. Flags are from `raw-sources/cosign-keyless-2026-10-25.md` (K1, K4).
Install [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) first. The identity string for a tag run is
inferred from the docs' branch example (K1), not stated by them: **on the first release, confirm the commands below succeed
before telling anyone to rely on them**, and fix this page if the identity differs.

### Tarball

Download `satis-agent-X.Y.Z-linux.tar.gz`, `SHA256SUMS` and `SHA256SUMS.sigstore.json` from the GitHub release into an empty directory.

```
cosign verify-blob SHA256SUMS \
  --bundle SHA256SUMS.sigstore.json \
  --certificate-identity "https://github.com/Sour-Dev-Home/satisfactory-dash/.github/workflows/agent-release.yml@refs/tags/agent-vX.Y.Z" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
sha256sum --check --ignore-missing SHA256SUMS
```

Both must succeed (`Verified OK`, then `...tar.gz: OK`). Only then unpack and install:

```
tar -xzf satis-agent-X.Y.Z-linux.tar.gz
cd satis-agent-X.Y.Z-linux
sudo ./install.sh
```

`install.sh` needs Node 22 or newer (the version CI builds and tests on), creates the `satis-agent` system user, puts
`agent.cjs` in `/opt/satis-agent` (root-owned), makes `/var/lib/satis-agent` (state, mode 700, the service user's) and installs the unit. It
**does not enable or start anything.** Then set the tokens and enrol as in [`agent-app.md`](./agent-app.md) (as the
`satis-agent` user, with `SD_AGENT_HOME=/var/lib/satis-agent`), and start it yourself:

```
sudo systemctl enable --now satis-agent
```

Update: verify the newer release as above, unpack, run `sudo ./install.sh` again, then `sudo systemctl restart satis-agent`.

### Container image

The release notes name the digest. Verify, then run that digest, never a tag:

```
cosign verify ghcr.io/sour-dev-home/satisfactory-dash-agent@sha256:<digest> \
  --certificate-identity "https://github.com/Sour-Dev-Home/satisfactory-dash/.github/workflows/agent-release.yml@refs/tags/agent-vX.Y.Z" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
gh attestation verify oci://ghcr.io/sour-dev-home/satisfactory-dash-agent@sha256:<digest> -R Sour-Dev-Home/satisfactory-dash
docker run -d --name satis-agent --restart unless-stopped -v satis-agent-state:/var/lib/satis-agent \
  ghcr.io/sour-dev-home/satisfactory-dash-agent@sha256:<digest>
```

The image runs as the unprivileged `node` user, keeps its state in the `/var/lib/satis-agent` volume (`SD_AGENT_HOME`) and holds no
secrets: set the tokens and enrol with `docker run --rm -it -v satis-agent-state:/var/lib/satis-agent <image> set-tokens` and
`... enroll <CODE> --url <backend>`. The agent only talks to a game on loopback or a private address, so the container
needs host networking or the game's network. Update: change the digest in your run command to the newly verified one and recreate the container.

## For the owner: cutting a release

See the PR that added this page for the exact steps; in short, a tag `agent-vX.Y.Z` on a commit on `main` is the only trigger.
Test the build first with Actions, "Agent release", Run workflow: it builds the tarball and the image for both platforms and
publishes, signs and releases nothing.
