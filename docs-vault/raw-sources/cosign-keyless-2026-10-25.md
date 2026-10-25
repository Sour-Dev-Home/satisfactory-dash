Source: https://github.com/sigstore/cosign (README.md, doc/cosign_sign.md, doc/cosign_sign-blob.md, doc/cosign_verify-blob.md), cosign v3.1.4 docs as served by Context7 (/sigstore/cosign) on the capture date
Captured: 2026-10-25
Method: documentation-retrieval tool (Context7); excerpts below are the tool's, trimmed, not re-checked against the raw pages.
Source kind: official cosign (Sigstore, Apache-2.0) documentation; quoted excerpts only.
Why it is here: ADR-0057 Decision 7 (release signing). Closes its "[NEEDS VERIFICATION] against current cosign docs when built".
FINDINGS (as the docs state them):
  - K1. Keyless blob signing: `cosign sign-blob artifact --bundle artifact.sigstore.json --yes`; verify:
        `cosign verify-blob artifact --bundle artifact.sigstore.json --certificate-identity "https://github.com/ORG/REPO/.github/workflows/release.yml@refs/heads/main" --certificate-oidc-issuer "https://token.actions.githubusercontent.com"`.
        The bundle holds the signature, certificate and transparency-log proof.
  - K2. `sign-blob` options include `--bundle`, `--yes`, `--oidc-provider` (github-actions among them; unset tries all ambient providers), `--identity-token`.
  - K3. Image: "Make sure to sign the image by its digest (@sha256:...) rather than by tag (:latest)". `cosign sign <IMAGE DIGEST>` is the keyless flow;
        `--recursive` signs "a multi-arch container image AND all referenced, discrete images".
  - K4. Verify an image: `cosign verify $IMAGE --certificate-identity=$IDENTITY --certificate-oidc-issuer=$OIDC_ISSUER`; regex forms
        `--certificate-identity-regexp` and `--certificate-oidc-issuer-regexp` exist.
  - K5. Keyless signing puts the signing identity in the public transparency log permanently (the docs' warning about "personally identifiable information").
NOT FOUND (recorded, not guessed):
  - The exact certificate identity a GitHub Actions tag run gets (this repo's `.../.github/workflows/agent-release.yml@refs/tags/agent-vX.Y.Z`) is inferred from K1's `@refs/heads/main` example, not stated: the runbook has the reader check it against the real signature on the first release.
  - Whether the pinned cosign-installer's default cosign release matches v3.1.4: the first workflow run shows the version it installed.
