# DRAFT: privacy page and terms copy for self-serve servers (#530)

Status: draft for the owner's review (asked 2026-10-20). ADR-0046 task 8. **Nothing here is live.** No page has been
edited. The owner writes or approves the final copy; this is a starting point, not legal advice.

Sources: issue #530; ADR-0046 sections 2, 5, 9 and Q5/Q6 (the owner answered yes to all six questions by merging #531);
ADR-0045 section 5 and Amendment 1; ADR-0035; `runbooks/abuse-response.md` (#516); the live
`frontend/public/privacy.html` and `frontend/public/terms.html` (last updated 16 October 2026 on the privacy page).

Conventions: "Replaces" quotes the live text. "Goes" says where on the page. Text in `[square brackets]` is a
placeholder. `[NEEDS VERIFICATION]` means the repo does not show it. The contact alias is the one on the live page.
The owner's name appears on the live privacy page only; here it is `[the owner's name, as on the current page]`.

## Part 1. Privacy page: the five changes in ADR-0046 section 9

### 1. Google-account row (also covers creating an account)

Goes: first row of the "What we collect, and why" table.

Replaces:
> Your Google account id and verified email address | Signing you in, and matching you to invitations

New:
> Your Google account id and verified email address | Creating your account the first time you sign in, signing you in afterwards, and matching you to invitations

Linked change (ADR-0046 Q5, approved: a neutral generated name for new accounts, not the email's local part). The
next row currently reads:
> A display name (one you choose, or taken from your email) | Shown to the people you share a server with

New:
> A display name (a generated one such as "Player-4F2K" when your account is created; you can change it) | Shown to the people you share a server with

[NEEDS VERIFICATION] that users can change the generated name, and the exact format. ADR-0046 says only "a neutral
generated one such as Player-XXXX". Existing accounts may still have an email-based name; if so, keep the old wording
for them or say "older accounts may use the first part of the email".

### 2. New row: enrolment and agent data per server

Goes: after the "Server names, memberships and roles" row.

New row:
> Enrolment and agent data for each server: a one-time setup code (stored only as a hash), a credential for the agent or mod (stored only as a hash), the agent or mod version, and the time it last connected | Linking your game server to your account, keeping other programs out, and showing you whether it is online

Evidence: `agents.enrollment_codes.code_hash`, `agents.agent_credentials.secret_hash`, `agent_version`,
`last_seen_at` (`backend/migrations/1790899200000_agents.sql:20-38`). The code is shown to you once and expires
(ADR-0046 Context; "10-minute expiry" in section 2, C7). We also keep who made the code (`created_by`, a user id) in the
same table. Add "and which account made it" only if the owner wants it listed. [owner choice]

### 3. What the mod sends, next to the player-names row

Goes: directly after the existing player-names row, as its own row. The existing row is also reworded so it is clear
that names come from the edge agent, not the mod.

Replaces:
> In-game names of players connected to a server you're a member of | Shown live to that server's members only; not stored and not logged. They come from the server owner's own game server, and the server owner is responsible for telling their players.

New (names row):
> In-game names of players connected to a server you're a member of, when the server uses the edge agent | Shown live to that server's members only. Kept in memory, never written to the database or the logs. They come from the server owner's own game server, and the server owner is responsible for telling their players.

New (mod row):
> What the Satis Manager mod sends: how many players are connected and the player limit, plus game-world data (power, production, machine states, building positions) | The dashboard. The mod does not send player names or account ids. Game-world data describes the factory, not you.

Evidence: ADR-0045 Amendment 1 point 2 (mod v1 sends `connectedPlayers` and `playerLimit`, never names; its spec
forbids user names and account ids beyond the contract). Edge-agent names: ADR-0045 R1 and M14
(`agentSnapshotStore.ts`, kept in memory; `backend/src/platform/logger.ts` redacts `players`).
[NEEDS VERIFICATION] that the mod sends nothing else personal. The 200-character free-text fields (class names, session
name, `packages/shared/src/agent.ts:85`) could hold anything a modified mod puts there (ADR-0045 R4, accepted). Also
[NEEDS VERIFICATION] whether the player count is saved in history or only shown live. If it is saved, add it to the
"Game data" retention bullet below. If a later mod version sends names, this row must change first (ADR-0045 Amendment 1).

### 4. The operator may disable an account or delete a server; what deleting a server removes

Goes: a new short section "Abuse, and removing servers", placed after "Who else handles data" and before
"How long it's kept". Also one new bullet under "How long it's kept" (below).

New section:
> **Abuse, and removing servers**
>
> If someone abuses the service, the operator can disable their account and delete their servers. Disabling signs the
> person out, stops their agents from connecting, and stops Google sign-in for that account. Their server data is kept
> unless the server is also deleted.
>
> When a server is deleted, by you or by the operator, we remove what is stored for it:
> - the people who belong to it, and their roles
> - the encrypted game-server tokens
> - the history of power, production and machine states
> - alert rules, alert history, mutes, and the encrypted Discord webhook
> - push-notification sign-ups for that server
> - the saved map layers
> - setup codes, the agent credential, and any pending commands
>
> We keep a short record that the server existed (its name and id) and the audit events about it. These hold no emails
> or names of people. Backups can still hold the data for up to 37 days (see "How long it's kept").
>
> A server that is created but never connected to an agent is removed after 24 hours.

Evidence: delete list from `runbooks/abuse-response.md` section 2 (table; `servers.server_members`, `server_connections`,
telemetry tables, `alerts.*`, `alerts.push_optins`, `map.world_layers`, `agents.*`). Disable behaviour: same runbook
section 3 and ADR-0046 section 5. 24 hours: ADR-0046 cap C4 (a number the owner approved in Q2; the operator can change
it by setting). "Name and id stay": runbook, "What stays on purpose". [NEEDS VERIFICATION] that the 24-hour sweep (task
#527 or nearby) has shipped and that a user-deleted server runs the same purge as the operator's `remove-server`. The
runbook says the HTTP route "is the same delete".

New bullet in "How long it's kept", after the Backups bullet:
> - A deleted server's data: removed at once (the list above), except in backups, which age out within 37 days.

### 5. Account-deletion paragraph (must match what #311 builds)

Goes: the second paragraph of "Your choices and rights".

Replaces:
> Deleting your account removes your user record, your sign-in identity, your sessions and your memberships. A server you own is handed over or deleted first. You can also stop using Google sign-in for us at any time from your Google account settings.

[NEEDS VERIFICATION] #311 is still a backlog card. No deletion flow exists in the repo yet, so this paragraph cannot be
finished until it ships. What the card requires: a server is never left ownerless; deleting an account that is a server's
last owner either soft-deletes the server or transfers ownership explicitly. Proposed text, to check against the build:

> You can delete your account yourself. That removes your user record, your sign-in identity, your sessions and your
> memberships. If you are the only owner of a server, you must hand it to another member or delete it first, and
> deleting it removes its data as described in "Abuse, and removing servers". Servers you only belong to are left
> as they are. Audit events about your actions are kept for 1 year; they hold your user id, not your email or name.
> You can also stop using Google sign-in for us at any time from your Google account settings.

Checks for the final wording: does the flow refuse, auto-delete, or transfer? Is the audit actor id removed or kept?
(The runbook says audit rows hold ids only. An id that no longer resolves is the design: see the `created_by` comment in
the agents migration.)

### Smaller edits the same page needs

- **Date:** change "Last updated" on the day it goes live.
- **"Who else handles data" / Backblaze:** no change. Keep "Backblaze stores encrypted backups for up to 37 days"
  (ADR-0035). Check the AWS bullet: the older AWS copies are removed within 37 days of the cutover. By the time sign-up
  opens, delete that sentence if it is past (`ADR-0035`, step 5; ADR-0035 says the AWS account closes by 2027-03-15).
- **"Children":** unchanged (13+). See Part 4.
- **Intro line** "describes what the service actually does": keep, and re-read the whole page after the build ships.

## Part 2. Terms page

### 2a. What a self-serve owner agrees to

Goes: the "Your servers" section is extended, and "Ending things" is replaced. Plain wording:

Replaces (Your servers):
> Only connect servers you have the right to administer. You're responsible for the access tokens you configure, and for who you invite: the people you invite see your server's data.

New (Your servers):
> Only connect servers you have the right to administer. You're responsible for the access tokens and setup codes you
> create, and for who you invite: the people you invite see your server's data.
>
> **Tell your players.** When you connect a server, data about it is sent to Satis Manager. With the edge agent, that
> includes the in-game names of connected players, shown live to your server's members. With the mod, it is player
> counts only. You are responsible for telling the people who play on your server, and for having the right to share
> this data. See the [Privacy Policy](/privacy).

New (Acceptable use), two bullets added to the existing list:
> - Don't use a server to send data that isn't from a real game (forged readings), or to store things that have nothing to do with Satisfactory.
> - Don't create accounts or servers just to get around the limits below.

New (Limits, a new section):
> **Limits.** Each account may own up to [2] servers. Only [1] of them may be waiting to connect at a time, and a server
> that is not connected within [24 hours] is removed. You can create up to [5] servers a day and ask for up to [20] setup
> codes an hour. The service as a whole has room for a limited number of servers, and new sign-ups are limited per hour,
> so a request can be refused when it is full. The operator can change these limits at any time. Lowering a limit never
> deletes a server you already have.

Numbers are ADR-0046 caps C1, C3, C4, C5, C7 and C2/C8 (the owner approved them as listed in Q2). Square brackets mean:
if the operator changes a cap, update the page, or say "currently" and keep the numbers out of the terms. Recommended:
name the numbers in the terms only as "currently". The caps live in settings (`SELF_SERVE_MAX_SERVERS_PER_ACCOUNT` etc.,
ADR-0046 section 2).

Replaces (Ending things):
> You can delete your account at any time. The operator may suspend an account that breaks these terms, and may shut the service down, with notice where practical.

New (Ending things):
> You can delete your account, or delete a server you own, at any time. The operator may disable an account, and may
> delete a server, if they are broken or abused or if these terms are broken. Where practical the operator will tell you
> first, but it can act at once if the service is at risk. Deleting a server removes its data, as the Privacy Policy
> describes. The operator may also shut the service down, with notice where practical.

Replaces (Liability): keep as written, and add "or lost history, if a server is removed or a backup is restored":
> To the extent the law allows, the operator isn't liable for game-server outages, missed or late alerts, lost history, or anything else that comes from using the service.

No warranty: the existing "The service" section already says "provided as is, with no guarantee". Keep it, and add
"This applies to the free self-serve service too: there is no promise it stays free, stays online, or keeps your
history." [owner choice: promising nothing about price is a business call.]

### 2b. Explicit acceptance at sign-up (ADR-0046 Q6, approved)

The owner chose an explicit acceptance recorded at account creation: an audit event with the terms version, not a
"by signing in you agree" line. Wording shown on the first sign-in only (new accounts), with a checkbox that is not
pre-ticked and a button that stays disabled until it is ticked:

> **Before you create your account**
> To use Satis Manager you need to agree to two things.
> [ ] I have read the [Terms of Use](/terms) and the [Privacy Policy](/privacy), and I agree to the Terms.
> [ ] I am at least 13 years old. [owner decision: see Part 4]
> [Create my account]  [Cancel]

Record (per ADR-0046 Q6): an audit event "terms accepted" with the user id and the terms version (a date or a number).
No email or name in it. [NEEDS VERIFICATION] This is not built in the repo today (`identity/` has no terms code), and
the build task for it is not in the ADR-0046 build plan. Either #530's page work waits for it, or the owner adds a
task. Questions: do existing invited users accept on their next sign-in, and what happens when the terms change
(re-accept, or notice only)?

## Part 3. What a self-serve server sends and keeps

Plain statement for the owner to reuse (privacy page row text, ficsit.app listing, the setup screen):

| Data | Mod | Edge agent | Kept? | Evidence |
|---|---|---|---|---|
| Number of players connected, player limit | Sent | Sent | Live only [NEEDS VERIFICATION whether history stores the count] | ADR-0045 Amendment 1; mod spec (S13) is in the mod repo and is not checked here |
| Player names | **Never sent** | Sent | **Memory only; never in the database or logs** | ADR-0045 Amendment 1, R1, M14; `agentSnapshotStore.ts`; `logger.ts` redacts `players` |
| Account ids of players | Never sent | [NEEDS VERIFICATION] `PlayerSchema` fields beyond the name | n/a | `packages/shared/src/players.ts` not read for this draft |
| Game-world data (power, production, machines, positions) | Sent | Sent | Yes, as history | ADR-0027 PR 3; privacy page "How long it's kept" |
| Version and last-seen time | Sent | Sent | Yes, while the credential exists | `agents.agent_credentials` |
| Credential and setup code | Hashed | Hashed | Hashes only | `agents` migration |

**History retention** (unchanged from the live page): detailed readings 48 hours, one-minute averages 30 days, hourly
averages 1 year, machine state changes 30 days. Alerts 90 days. Audit events 1 year. Server logs 14 days.

**What #515 limits per server** (so the page can say a server cannot use unlimited space): at most 64 circuits in each
power sample; every catalogued item plus at most 64 uncatalogued items in each item sample; a power rule tracks at most
64 circuits; at most 120 alert events a server an hour (commit `69e2c2a`, `historyQuota.ts`, `serverAlertEvaluator.ts:77`).
The 120 an hour was set in the first version of that commit; its review commit "cap history series per server per hour;
fairer event cap" may have changed it. [NEEDS VERIFICATION against the merged code before quoting any number.] Recommended:
do not publish these numbers on the privacy page; they are internal limits (see `runbooks/history.md`).

**Backups:** "Backblaze stores encrypted backups for up to 37 days" (ADR-0035, accepted by the owner 2026-09-26; live
page "Backups" bullet). A deleted server stays in backups until they age out, so up to 37 days.

**Deletion on remove:** see Part 1, item 4, and `runbooks/abuse-response.md` section 2. After removal "nothing is left
for that id", except the soft-deleted server row and its audit events. If a backup is restored, a removed server comes
back and the operator removes it again (runbook section 4). The privacy page already promises deleted data can survive
in backups; that covers this.

**Who sees it:** a self-serve owner sees their own server only (non-members get a 404). The operator can list every
server's name, id, owner user id, enrolment state, last-seen time and row counts through the command line, and can read
the database as data controller (ADR-0046 section 9). The operator can not open a self-serve server's dashboard. The
privacy page should say the operator can see these admin details, because "Audit events ... Security, and investigating
abuse" does not cover server lists. Suggested line under "Audit events": "Server lists for the operator: each server's
name, id, owner's user id, whether an agent is connected, and when it was last seen | Running the service and
investigating abuse".

## Part 4. Owner must decide or check

1. **Jurisdiction and governing law.** The live terms deliberately name none, so the operator's location is not
   published. Open sign-up to strangers raises the stakes. Decide whether to keep that, name a country only, or take advice.
2. **Does privacy law apply?** The page says it offers the same rights to everyone and claims no law. With open sign-up,
   users in the EU, UK and elsewhere will join. A lawyer should say whether a data-controller notice, a lawful-basis
   statement, a representative, or standard contract clauses for sending data to US providers are needed.
3. **Minimum age.** The page says 13+. Some places set the age at 16 for this kind of data processing. Check, and decide
   whether the tick box asks for it (Part 2b).
4. **Lawyer review.** Recommended before open sign-up, mainly for: the "tell your players" duty (a legal call, ADR-0046
   Q6), the liability wording, and the explicit-acceptance record. The terms point is also listed in ADR-0045 R5.
5. **Operator's name and address on the page.** The data controller is named; an address is deliberately left out. Some
   laws expect a contact address. Decide.
6. **Backups of a deleted server.** The 37 days is stated. Decide if "deleted means deleted from backups on request"
   is promised or not. The runbook restores an old backup that brings deleted data back.
7. **The record that stays.** After removal the server's name and id, and the audit events, are kept. A server name can be
   personal (people name servers after themselves). Decide to keep this, or clear the name on removal.
8. **Player names are shared with the server's members.** The owner is responsible for telling players. Decide if the
   setup screen shows a short notice to copy to the server's Discord. (Suggested, not required.)
9. **Terms version and re-acceptance.** What counts as a new version, and whether existing users must re-accept.
10. **Coffee Stain.** `LEGAL.md` keeps "player data the mod sends" as [NEEDS VERIFICATION] and no Coffee Stain terms were
    found. Mod v1 sends counts only, so the risk is smaller. Re-check if a later mod sends names.
11. **"Free" promise.** Part 2a says nothing about future price. Decide if that should be said.
12. **Cap numbers on the page.** Print them in the terms, or write "currently" and link to a settings page (Part 2a).
13. **Release order.** The page must describe what shipped: wait for #311 (deletion), the 24-hour sweep, the
    sign-up acceptance record, and the generated display name before publishing.
