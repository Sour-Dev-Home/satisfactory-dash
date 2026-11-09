- **ADR-0066 accepted (owner, 2026-11-09: "yes to all three, accept the ADR").** The three open questions are answered with
  their recommendations: `local` servers convert to `agent` and keep their sealed tokens until the final contract migration;
  the old Node-agent server is kept and its credential revoked; a backend without a database serves no game servers. This is
  build PR 1: banners on the ADRs it amends (0012, 0014, 0030, 0031, 0032, 0038, 0057, 0058), and ADR-0040 marked superseded.
  PRs 2 to 10 follow, each from main.
