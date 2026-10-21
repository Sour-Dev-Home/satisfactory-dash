- 2026-10-21 — #530: the approved privacy and terms copy (`proposals/530-privacy-terms-draft.md`, now marked published)
  is live in `frontend/public/privacy.html` and `terms.html`, both dated 21 October 2026, each claim checked against main.
  Privacy: new accounts keep no email and get a generated "Player-XXXX" name; new rows for the terms acceptance record,
  setup and agent data, live-only player counts, push subscriptions (the browser push service added as a processor) and
  the operator's server list; a reason (run the service, or keep it safe) on every row; a new "Abuse, and removing
  servers" section (what removal deletes, the name cleared, the id, creator's user id and audit events kept, the 24-hour
  never-connected sweep, saves never touched); the account-deletion paragraph rewritten to match #556; 18+ instead of 13+.
  Terms: 18+, price line, "Tell your players", a "Limits" section ("currently"), two acceptable-use bullets, alerts
  described as live and best effort, "Ending things" and liability extended, Georgia governing law, material changes
  defined. The terms version (`TERMS_VERSION`, backend `identity/signupConfig.ts` and frontend `auth/googleSignIn.ts`)
  goes from 2026-09-24 to 2026-10-21. Left off the pages because main does not ship it yet: the in-app account deletion
  and leave-a-server UI (#564), re-acceptance by existing accounts, changing the generated display name, and what the mod
  (a separate repository) does or does not send.
