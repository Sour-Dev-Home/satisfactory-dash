import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentStatusResponse } from "@satisfactory-dash/shared";
import { useAgentWrites, type EnrollmentCode } from "../api/agentWrites";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { formatTime } from "../format";
import { useNow } from "../lib/useNow";
import { useSelectedServer } from "../servers/ServerContext";
import { agentBackendUrl, canCreateCode, canRevoke, connectionText, lastSeenText } from "./agentText";

/**
 * Settings → Game PC agent (ADR-0031 PR 7): whether an agent reports for this server, when it was
 * last heard and its version, and for those allowed, an enrolment code and revoking. Every member
 * reads it. Keyed by server in the shell, so a code never follows the user to another server.
 */
export function AgentSettings() {
  const server = useSelectedServer();
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
      {status.isPending ? (
        <p role="status" className="mb-0">
          Loading the agent's status…
        </p>
      ) : !status.data ? (
        <ErrorNotice
          error={status.error}
          action={
            <button type="button" onClick={() => void status.refetch()}>
              Retry
            </button>
          }
        />
      ) : (
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
      )}
    </section>
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
  if (wasEnrolled !== agent.enrolled) {
    setWasEnrolled(agent.enrolled);
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
        {agent.enrolled && (
          <>
            <dt>Agent version</dt>
            <dd>{agent.agentVersion ?? "Not reported yet"}</dd>
          </>
        )}
      </dl>

      {code ? (
        <div role="group" aria-labelledby="agent-code-heading" className="grid gap-2">
          <h4 id="agent-code-heading" className="mb-0">
            Enrolment code
          </h4>
          <p className="mb-0 font-mono text-lg text-fg-strong">{code.code}</p>
          <p className="mb-0 text-sm text-muted">
            It works once, until <time dateTime={code.expiresAt}>{formatTime(code.expiresAt)}</time> (10 minutes), and
            isn't shown again after you leave this page. On the game PC, in the agent's folder, run:
          </p>
          {/* The agent app's command (docs-vault/wiki/runbooks/agent-app.md, "Enrol"). Whether --replace is
              needed depends on what the PC has stored, which the dashboard can't see, so it's only named. */}
          <p className="mb-0 font-mono text-sm break-all">
            node agent.cjs enroll {code.code} --url {agentBackendUrl(import.meta.env.VITE_API_URL)}
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
              <p className="mb-0">
                The agent stops working at once. This server then shows no data, and can't be changed, until an agent is
                enrolled again.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onRevoke} disabled={revoking}>
                  {revoking ? "Revoking…" : "Revoke the agent"}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={revoking}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button type="button" onClick={() => setConfirming(true)}>
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
