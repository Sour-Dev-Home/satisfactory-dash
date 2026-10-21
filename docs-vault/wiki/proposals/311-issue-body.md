Account deletion and leaving a server (ADR-0020, ADR-0047): never leave a server ownerless

### Goal
A player can leave a server and delete their account themselves, and neither ever leaves a live server without an
owner. A gate on the mod's first public release (ADR-0046 section 7; ADR-0025: "Account deletion ships with 1b at the
latest"). Design: ADR-0047 (`docs-vault/wiki/decisions/0047-account-deletion-and-leaving.md`).

### Acceptance criteria

**Task 1 (shipped, #511):** the rule in the database.
- [x] A server is never left ownerless except by the operator's own setup (deferred trigger
  `server_members_never_ownerless`, `backend/migrations/1791244800000_members_never_ownerless.sql`).
- [x] Any flow that creates a server for another user creates its owner membership in the same transaction.
- [x] Any account-deletion or leave flow that would remove a server's last owner either soft-deletes the server or
  transfers ownership explicitly; it never leaves the server ownerless.

**Task 2a: contract (`packages/shared` only, its own PR).**
- [ ] `KnownErrorCode` gains `would_orphan` and `reauth_required` (additive, with ADR comments like the others).
- [ ] `ApiErrorResponseSchema.error` gains optional `servers` (array of `AccountServerRef`, max 50), described as "the
  servers a `would_orphan` refusal is about".
- [ ] New `packages/shared/src/account.ts` with the schemas below, exported from `index.ts`; `endpoints.account.*` and
  `endpoints.members.leave` (flag `memberSelfService: true`); fixtures for each response.
- [ ] No behaviour change: the backend does not serve the routes yet (the endpoints comment says so, like
  `selfServe`).

**Task 2b: backend.**
- [ ] `softDeleteServer` gets an in-transaction form (`softDeleteServerIn(client, publicId, audit)`), and the existing
  pool form wraps it; the HTTP remove, #526's sweep, `remove-server` and account deletion all run the same list.
- [ ] **Leave:** `POST /api/servers/:serverId/members/me/leave`, after the membership check. Non-owner: one
  transaction deletes the caller's membership and their `alerts.push_optins` row for that server and writes
  `member_left` (ids and role) in the same statement; 200 `{ left: true }`. Owner: 409 `would_orphan`, reason
  `last_owner`. Non-member: 404 `server_not_found`. 10 a minute per user (`UserRateLimiter`), 429 `rate_limited`.
- [ ] **Preview:** `GET /api/account/deletion` answers what a deletion would do now (schema below), read-only.
- [ ] **Delete:** `DELETE /api/account`, database mode only, 5 an hour per user. In order:
  1. The operator's account (`canManage`): 403 `forbidden`, reason `operator_account`.
  2. One transaction: take `TAKE_SERVER_MANAGEMENT_LOCK`; check the caller's session row is at most 10 minutes old
     (`created_at > now() - interval '10 minutes'`, by its hash), else 403 `reauth_required`; lock the caller's live
     owned servers; if any is `created_via = 'operator'`, roll back with 409 `would_orphan`, reason `operator_servers`,
     `error.servers` listing them; else soft-delete each owned `self_serve` server in this transaction (audit
     `server.deleted`, actor the user, `detail: { reason: "account_deleted" }`); delete the user row (cascades sign-in
     identities, sessions, the remaining memberships, push subscriptions and their outbox rows, push opt-ins); write
     `account.deleted` (`detail: { userId, serversDeleted, membershipsLeft, pushSubscriptions }`, counts only).
  3. A commit refused by the ownerless trigger maps to 409 `would_orphan` (never 500).
  4. After the commit: drop each deleted server's runtime entry; clear the session cookie; 200
     `{ deleted: true, serversDeleted }`; one info log with the user id and counts, no email or name.
- [ ] A db test asserts every foreign key referencing `identity.users` is `ON DELETE CASCADE` (catalogue query, like the
  `PURGED_TABLES` guard), so a future table either cascades or fails the test.
- [ ] The generated authorization suite (`backend/src/serverAuthorization.test.ts`) covers leave: viewer and admin 200,
  owner 409, non-member 404.
- [ ] Tests: deletion with 0, 1 and 2 self-serve servers (each server's `PURGED_TABLES` rows gone, its agent gets 401);
  an owned operator server refuses with the list and changes nothing; a stale session (11 minutes) refuses and
  changes nothing; a create racing a deletion never leaves an ownerless server; the deleted user's old session cookie
  gets 401; audit rows hold no email or name; `npm run test:db` before pushing.
- [ ] If the owner says yes to ADR-0047 question 4: `npm run admin -- delete-user <user-id>` runs the same service
  without the session check (the operator account still refused), with its usage line.
- [ ] Runbook: `docs-vault/wiki/runbooks/abuse-response.md` gains the email-request deletion steps.

**Task 3: frontend (Settings).**
- [ ] **Leave server** in the Settings page's server area, shown only when `ServerSummary.role` is `admin` or
  `viewer`. An owner sees instead a pointer to "Delete server" (self-serve, #529's control) or "only the operator can
  remove this server". A confirmation dialog names the server and says leaving removes the user's access and push
  alerts for it (copy pointer; the owner approves the copy). On 200: refetch the server list and move to another
  server or the empty state. On 404: refresh as if it already happened. On `would_orphan`: show the owner pointer.
- [ ] **Delete account** in a new "Account" section of Settings. Opening it loads the preview and lists: the servers
  that will be deleted with all their history (names), the servers the user will leave, the number of push devices,
  that it can't be undone, and that backups keep data up to 37 days (copy pointer).
  - `blockingServers` non-empty or `operatorAccount`: the confirm button is disabled with the reason (operator
    servers: "ask the operator to remove or transfer them", listed).
  - `reauthRequired`: the dialog offers "Sign in again to continue" (Google start with a return path back to Settings
    that reopens the dialog); a `reauth_required` from the DELETE itself (the window ran out) does the same.
  - A typed confirmation (copy pointer: type the word shown) enables the destructive button.
  - On 200: unsubscribe this browser's push subscription locally, clear the client cache, go to the landing page with
    a one-line "account deleted" notice.
- [ ] Both hidden in demo mode. Design tokens only, ease-in-out transitions, dialog focus trap and return, axe clean;
  RTL tests per state above with MSW handlers built from the shared fixtures; Playwright screenshots; `ui-reviewer`.
- [ ] **Privacy page pointer for #530** (not built here): the deletion paragraph (`frontend/public/privacy.html`
  lines 165-167) must say what ships: the user record, Google sign-in link, sessions, memberships, push devices and
  opt-ins go at once; self-serve servers you own are deleted with everything listed for a server delete; an
  operator-created server you own must be removed or transferred by the operator first (replace "handed over"); audit
  events keep a random account id, no email or name, for up to 1 year; logs 14 days and backups 37 days; leaving a
  server removes your membership and push opt-in for it; deletion by email stays available.

### Interface contract
`packages/shared/src/account.ts` (task 2a). Names are the contract; the developer may adjust the wording of descriptions.

```ts
export const AccountServerRefSchema = z.object({
  serverId: ServerIdSchema,
  displayName: DisplayNameSchema,
});

// GET /api/account/deletion
export const AccountDeletionPreviewSchema = z.object({
  serversToDelete: z.array(AccountServerRefSchema),   // owned, self-serve: deleted with all their data
  blockingServers: z.array(AccountServerRefSchema),   // owned, operator-created: deletion refused while non-empty
  serversToLeave: z.array(AccountServerRefSchema),    // admin/viewer memberships that end
  pushDevices: z.number().int().nonnegative(),
  operatorAccount: z.boolean(),                        // true: deletion always refused
  reauthRequired: z.boolean(),                         // session older than the window: sign in again first
});

// DELETE /api/account (no body)
export const DeleteAccountResponseSchema = z.object({
  deleted: z.literal(true),
  serversDeleted: z.number().int().nonnegative(),
});

// POST /api/servers/:serverId/members/me/leave (no body)
export const LeaveServerResponseSchema = z.object({ left: z.literal(true) });
```

Endpoints: `account.deletionPreview` (GET `/api/account/deletion`), `account.delete` (DELETE `/api/account`),
`members.leave` (POST `/api/servers/:serverId/members/me/leave`, `memberSelfService: true`).

| Route | Success | Errors |
|---|---|---|
| leave | 200 `{ left: true }` | 409 `would_orphan` (`last_owner`); 404 `server_not_found`; 429 `rate_limited`; 401; 503 |
| preview | 200 preview | 401; 503 |
| delete | 200 `{ deleted: true, serversDeleted }`, session cookie cleared | 403 `forbidden` (`operator_account`); 403 `reauth_required`; 409 `would_orphan` (`operator_servers`, `error.servers`); 429; 401; 503 |

Backend ports (task 2b, no new module edge): `identity/` defines
`AccountServersPort { preview(db, userId); deleteOwned(client, userId, actor): Promise<{ deleted: string[]; blocking: AccountServerRef[] }> }`;
`servers/` implements it from its `index.ts`; the composition root wires it and drops the runtime entries after the
commit. `ALLOWED_MODULE_EDGES` is unchanged.

### Scope
In: `packages/shared/src/{account,errors,endpoints,index}.ts` and fixtures (2a); `backend/src/modules/identity/`
(account service and routes), `backend/src/modules/servers/` (leave route, the port, `softDeleteServerIn`), the
composition root, `platform/metrics/registry.ts` query names, `backend/scripts/admin.ts` (if question 4 is yes),
runbooks (2b); `frontend/src/settings/`, `frontend/src/shell/Shell.tsx`, the API client and mocks (3).
Out: the privacy and terms copy (#530); a members API, transfer route or invites (ADR-0025 1b); a grace period, data
export, tombstones (ADR-0047 deferred).

### Blocked by
- The owner's approval of ADR-0047.
- 2a: after #524 merges (one `packages/shared` PR at a time).
- 2b: after #526 merges. Both edit `servers/repositories/serverRepository.ts` (`softDeleteServer` and its audit
  `detail`), `servers/serverManagement.ts` (remove and the runtime drop), `backend/src/server.ts`,
  `backend/src/serverAuthorization.test.ts` and `platform/metrics/registry.ts`; never build them in parallel. Not in
  parallel with #528 either (`identity/` routes and index, `server.ts`).
- 3: after 2b and #529 (both edit `frontend/src/shell/Shell.tsx`, the API client and its mocks), and after #528's
  frontend part (`frontend/src/auth/`).
- #530 (privacy page) after task 3, so it describes what shipped.

### Tier
2a: light (contract only). 2b: full (security-reviewer, test-hunter; it deletes accounts and data). 3: full UI
(ui-reviewer, test-hunter).
