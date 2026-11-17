- **Gate B PR 1: `admin grant-owner`, the break-glass before password login goes** (owner, 2026-11-17, #186).
  - `npm run admin -- grant-owner --email <address>` (`identity/ownerAdmin.ts`) unlinks the operator's Google identity,
    stores the address on the operator, ends the operator's sessions and writes an `owner.granted` audit row (ids and
    counts only), all in one transaction.
  - `googleSignIn.ts` now links the operator by its stored email when it has one, else by `BOOTSTRAP_OWNER_EMAIL`. A
    stolen old account carrying the bootstrap address can't relink after a grant.
  - New `admin` ops task (`infra/aws/ops.tf`) with only the app's `DATABASE_URL`, and the runbook section aws.md
    "Admin commands". ADR-0025 gets the gate B amendment.
