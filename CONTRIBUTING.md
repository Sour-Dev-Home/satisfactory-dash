# Contributing

Contributions are welcome once you have signed the [Contributor License Agreement](CLA.md).

This project is licensed under the GNU Affero General Public License v3.0 only (see
`LICENSE`), and the copyright holder wants to keep the option of also offering commercial
terms (ADR-0018). That needs every outside contributor to grant relicensing rights, which is
what the CLA does. You keep the copyright in your work.

## Signing the CLA

1. Open a pull request. A bot comments with a link to [CLA.md](CLA.md).
2. Read it, then reply on the pull request with exactly:
   `I have read the CLA Document and I hereby sign the CLA`
3. The bot records your GitHub username, numeric user ID and the date in this repository's
   public signature list (nothing else about you) and the check turns green. You sign once; it covers your
   later pull requests too. Comment `recheck` if the check doesn't update.

The CLA is a draft that a lawyer has not reviewed yet.

## Before you open a pull request

- Read the project rules in `CLAUDE.md` and `docs-vault/wiki/decisions/`. Bigger changes
  should start as an issue, so the design is agreed before the code is written.
- Run `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build`; CI runs the
  same and must be green.
- Changes to real logic need tests. Changes to `packages/shared/` are changes to the API
  contract and should be their own pull request.
- Never commit personal information (real names as data, emails, phone numbers) or local
  file paths that point into your own home folder; CI scans for them.
- Security problems: please don't open a public issue. Contact the maintainer privately
  through GitHub instead.

Issues (bug reports and ideas) are welcome.
