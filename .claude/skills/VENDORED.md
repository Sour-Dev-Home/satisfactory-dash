# Vendored skills

Third-party skills copied into this repo. Each was read in full before vendoring.

Source: https://github.com/jezweb/claude-skills (MIT)
Pinned commit: 1260fa7439b36b18dbf16648ccc7fb44783f6c23
Copyright (c) 2025 Jeremy Dawes (Jezweb). License text in each skill's `LICENSE`.
Vendored: 2026-10-20

| Skill | Upstream path |
|---|---|
| `ux-audit/` | `plugins/dev-tools/skills/ux-audit/` |
| `responsiveness-check/` | `plugins/dev-tools/skills/responsiveness-check/` |

## Local edits

All edits are additive notes that neutralise risky guidance; no upstream text was deleted.

- `ux-audit/SKILL.md`: "Local rules" block after the intro (no local dev server, no cookie/token minting, nothing sent off-machine including `brains-trust`, no local visual baselines, no inviting or emailing real people, no absolute paths or personal data, no global installs).
- `ux-audit/references/browser-tools.md`, `auth-expired-handling.md`, `project-adaptation.md`: test-auth cookie minting and auth-bypass sections marked disabled.
- `ux-audit/references/data-seasoning.md`: seed/reset scripts only against an approved local or disposable database.
- `responsiveness-check/SKILL.md`: short "Local rules" note (no local dev server, nothing off-machine, no paths or personal data).
- `ux-audit/references/a11y-automation.md`: note to use the repo's own `@axe-core/playwright` instead of injecting axe-core from cdnjs (upstream snippet kept for reference).
- `LICENSE` files added per skill (copied unchanged from upstream).

## Known upstream behaviours left as-is
- Skills reference Playwright MCP, Chrome MCP and `playwright-cli`; they install nothing themselves.
