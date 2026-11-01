import { Loadable, Skeleton, SkeletonStatus } from "../ui/Skeleton";
import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentStatusResponse } from "@satisfactory-dash/shared";
import { useAgentWrites, type EnrollmentCode } from "../api/agentWrites";
// The API origin through the transport (never import.meta.env here): the demo build swaps the
// transport, so its bundle never carries the real API's URL (e2e/build-output.spec.ts).
import { apiHref } from "../api/client";
import { queries } from "../api/queries";
import { CopyButton } from "../components/CopyButton";
import { DANGER_BUTTON, DANGER_BUTTON_QUIET } from "../components/dangerButton";
import { ErrorNotice } from "../components/ErrorNotice";
import { formatTime } from "../format";
import { useNow } from "../lib/useNow";
import { EnrolmentGuide } from "../selfServe/EnrolmentGuide";
import { useSelectedServer } from "../servers/ServerContext";
import { cn } from "../lib/cn";
import { agentBackendUrl, agentVersionLine, canCreateCode, canRevoke, connectionText, gameConnectionView, lastSeenText, type GameConnectionView } from "./agentText";
import { useHashTarget } from "../lib/useHashTarget";

const isAgentAnchor = (id: string) => id === "agent";

/**
 * Settings → Game PC agent (ADR-0031 PR 7): whether an agent reports for this server, when it was
 * last heard and its version, and for those allowed, an enrolment code and revoking. Every member
 * reads it. Keyed by server in the shell, so a code never follows the user to another server.
 */
export function AgentSettings() {
  const server = useSelectedServer();
  // /app/settings#agent (#351's deep links) scrolls here.
  useHashTarget(isAgentAnchor);
  const isOperator = useQuery(queries.servers()).data?.canManageServers === true;
  const status = useQuery(queries.agentStatus(server.id));
  const { createCode, revoke } = useAgentWrites(server.id);
  // The code lives only here: shown once, gone when the section unmounts (see useAgentWrites).
  const [code, setCode] = useState<EnrollmentCode | null>(null);
  // `createCode.isPending` lags a synchronous double click (its state update isn't flushed between
  // two clicks in the same tick), so a plain `disabled={creating}` still lets a second click through
  // and creates a second code server-side. This ref is set synchronously, so the second click is a
  // no-op regardless of when React re-renders the disabled button.
  const creatingRef = useRef(false);

  const onCreate = () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    createCode.mutate(undefined, {
      onSuccess: (answer) => {
        setCode(answer);
        createCode.reset();
      },
      onSettled: () => {
        creatingRef.current = false;
      },
    });
  };

  return (
    <section id="agent" aria-labelledby="agent-settings-heading" className="panel grid gap-4">
      <h3 id="agent-settings-heading">Game PC agent</h3>
      <Loadable pending={status.isPending} skeleton={<AgentSkeleton />} className="grid gap-4">
      {!status.data ? (
        <ErrorNotice
          error={status.error}
          action={
            <button type="button" onClick={() => void status.refetch()}>
              Retry
            </button>
          }
        />
      ) : (
        <>
        {/* ADR-0046: the player's own server needs to be told where the code goes (the mod's config file). */}
        {server.createdVia === "self_serve" && canCreateCode(status.data.connectionKind, server.role, isOperator) && (
          <EnrolmentGuide enrolled={status.data.enrolled} />
        )}
        <AgentPanel
          agent={status.data}
          code={code}
          canCreate={canCreateCode(status.data.connectionKind, server.role, isOperator)}
          canRevoke={canRevoke(server.role)}
          creating={createCode.isPending}
          createError={createCode.error}
          onCreate={onCreate}
          revoking={revoke.isPending}
          revokeError={revoke.error}
          onRevoke={() => revoke.mutate(undefined, { onSuccess: () => setCode(null) })}
        />
        </>
      )}
      </Loadable>
    </section>
  );
}

/** The agent's status while it loads: the status line and the buttons under it. */
function AgentSkeleton() {
  return (
    <div className="grid gap-3">
      <SkeletonStatus>Loading the agent's status…</SkeletonStatus>
      <Skeleton className="h-lh w-64" />
      <Skeleton className="h-touch w-40" />
      {/* A phone wraps the agent's lines: about one more. */}
      <Skeleton className="h-lh w-48 sm:hidden" />
    </div>
  );
}

/**
 * "Game: ✓ Reachable · last read 8 s ago" (#740 follow-up): whether the agent could read the game in its last snapshot.
 * The state is always in words; the icon and colour only repeat it. Nothing when the agent doesn't report it.
 */
const TONE_CLASS = new Map<GameConnectionView["tone"], string>([
  ["ok", "text-ok"],
  ["warn", "text-warn"],
  ["unknown", "text-muted"],
]);

function GameConnectionRow({ agent, now }: { agent: AgentStatusResponse; now: number }) {
  const view = gameConnectionView(agent, now);
  if (view === null) return null;
  return (
    <>
      <dt>Game</dt>
      <dd>
        <span className={cn("inline-flex items-center gap-1", TONE_CLASS.get(view.tone))}>
          {view.tone !== "unknown" && <GameConnectionIcon tone={view.tone} />}
          {view.label}
        </span>
        {view.lastRead !== null && (
          <>
            {" · "}
            {agent.lastGameReadAt !== undefined ? (
              <time dateTime={agent.lastGameReadAt} title={formatTime(agent.lastGameReadAt)}>
                {view.lastRead}
              </time>
            ) : (
              view.lastRead
            )}
          </>
        )}
      </dd>
    </>
  );
}

/** A check for reachable, a warning triangle for not: decorative, the label beside it says the same. */
function GameConnectionIcon({ tone }: { tone: "ok" | "warn" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="size-4 flex-none" data-icon={tone}>
      {tone === "ok" ? (
        <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <>
          <path d="M8 1.75 14.75 14H1.25z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M8 6v3.5M8 11.75v.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** Presentational: one server's agent, and the controls this user may use. */
export function AgentPanel({
  agent,
  code,
  canCreate,
  canRevoke,
  creating,
  createError,
  onCreate,
  revoking,
  revokeError,
  onRevoke,
}: {
  agent: AgentStatusResponse;
  code: EnrollmentCode | null;
  canCreate: boolean;
  canRevoke: boolean;
  creating: boolean;
  createError: Error | null;
  onCreate: () => void;
  revoking: boolean;
  revokeError: Error | null;
  onRevoke: () => void;
}) {
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  // `agent` is re-read (this panel stays mounted across polls), so a confirm left open by a revoke
  // must not resurface if this server is later enrolled again. Adjusted during render, React's
  // documented way to reset state when a prop changes, rather than an effect (which would commit
  // the stale confirm UI for a frame first).
  const [wasEnrolled, setWasEnrolled] = useState(agent.enrolled);
  // Focus follows the confirm (ui review): into its warning when it opens, so a keyboard user hears
  // it before reaching the destructive button; back to "Revoke…" on Cancel. Stable callbacks: this
  // panel re-renders every second (the last-seen clock), and a new callback would re-focus each time.
  const focusWarning = useCallback((el: HTMLElement | null) => el?.focus(), []);
  const focusElement = useCallback((el: HTMLElement | null) => el?.focus(), []);
  const [returnFocus, setReturnFocus] = useState(false);
  if (wasEnrolled !== agent.enrolled) {
    setWasEnrolled(agent.enrolled);
    setReturnFocus(false);
    if (!agent.enrolled && confirming) setConfirming(false);
  }
  const local = agent.connectionKind === "local";
  return (
    <>
      <dl className="mb-0">
        <dt>Reached</dt>
        <dd>{connectionText(agent.connectionKind)}</dd>
        <dt>Agent</dt>
        <dd>
          {agent.enrolled ? (
            <>
              Enrolled ·{" "}
              {/* The backend's call (a snapshot within 2 minutes, #263); absent from an older backend. */}
              {agent.online !== undefined && (
                <>
                  <span className={agent.online ? "text-ok" : "text-warn"}>{agent.online ? "Online" : "Offline"}</span>
                  {" · "}
                </>
              )}
              {agent.lastSeenAt === null ? (
                lastSeenText(null, now)
              ) : (
                <time dateTime={agent.lastSeenAt} title={formatTime(agent.lastSeenAt)}>
                  {lastSeenText(agent.lastSeenAt, now)}
                </time>
              )}
            </>
          ) : (
            "None enrolled"
          )}
        </dd>
        <GameConnectionRow agent={agent} now={now} />
        {agent.enrolled && (
          <>
            <dt>Agent version</dt>
            <dd>{agentVersionLine(agent.agentVersion, agent.modVersion)}</dd>
          </>
        )}
      </dl>

      {code ? (
        <div role="group" aria-labelledby="agent-code-heading" className="grid gap-2">
          <h4 id="agent-code-heading" className="mb-0">
            Enrolment code
          </h4>
          <div className="flex items-center gap-2">
            <p className="mb-0 font-mono text-lg text-fg-strong">{code.code}</p>
            <CopyButton text={code.code} label="Copy the enrolment code" />
          </div>
          <p className="mb-0 text-sm text-muted">
            It works once, until <time dateTime={code.expiresAt}>{formatTime(code.expiresAt)}</time> (10 minutes), and
            isn't shown again after you leave this page. On the game PC, in the agent's folder, run:
          </p>
          {/* The agent app's command (docs-vault/wiki/runbooks/agent-app.md, "Enrol"). Whether --replace is
              needed depends on what the PC has stored, which the dashboard can't see, so it's only named. */}
          <p className="mb-0 font-mono text-sm break-words">
            node agent.cjs enroll {code.code} --url {agentBackendUrl(apiHref(""))}
          </p>
          <p className="mb-0 text-sm text-muted">
            If this PC was enrolled before (or the agent was revoked), add <code>--replace</code>.
          </p>
        </div>
      ) : (
        canCreate && (
          <div className="grid gap-2">
            {local && (
              <p className="mb-0 text-sm text-muted">
                Enrolling an agent switches this server to it: the dashboard stops reaching the game server directly and
                forgets its stored game-server tokens.
              </p>
            )}
            <div>
              <button type="button" onClick={onCreate} disabled={creating}>
                {creating ? "Creating…" : agent.enrolled ? "Create a code to enrol again" : "Create enrolment code"}
              </button>
            </div>
          </div>
        )
      )}
      {createError && <ErrorNotice error={createError} />}

      {agent.enrolled && canRevoke && (
        <div className="grid gap-2">
          {confirming ? (
            <div role="group" aria-label="Confirm revoking the agent" className="grid gap-2">
              <p ref={focusWarning} tabIndex={-1} className="mb-0">
                The agent stops working at once. This server then shows no data, and can't be changed, until an agent is
                enrolled again.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onRevoke} disabled={revoking} className={DANGER_BUTTON}>
                  {revoking ? "Revoking…" : "Revoke the agent"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setReturnFocus(true);
                  }}
                  disabled={revoking}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button
                ref={returnFocus ? focusElement : undefined}
                type="button"
                onClick={() => {
                  setConfirming(true);
                  setReturnFocus(false);
                }}
                className={DANGER_BUTTON_QUIET}
              >
                Revoke…
              </button>
            </div>
          )}
          {revokeError && <ErrorNotice error={revokeError} />}
        </div>
      )}

      {!canCreate && (
        <p className="mb-0 text-sm text-muted">
          {local
            ? "Only the dashboard's operator can enrol an agent for this server."
            : "Only a server owner or admin can enrol or revoke the agent."}
        </p>
      )}
    </>
  );
}
