import type { AlertDestinationsResponse, AlertEvent, AlertRule, AlertStatusResponse } from "@satisfactory-dash/shared";
import { formatTime } from "../format";
import { cn } from "../lib/cn";
import {
  alertTitle,
  disabledReasonText,
  eventDetail,
  itemOf,
  severityClass,
  severityLabel,
  transitionLabel,
} from "./alertText";

/**
 * The Alerts page's read-only views (ADR-0027 PR 9a), from the schema types only. Every member of
 * the server sees these; the owner/admin controls come in 9c.
 */

/**
 * Whether alerts go out at all, the mute, and what's firing now. `rules` (when loaded) names the
 * item a production alert is about: the status itself only says "item".
 */
export function AlertStatusPanel({ status, rules }: { status: AlertStatusResponse; rules?: readonly AlertRule[] }) {
  const itemFor = (ruleId: string) => itemOf(rules?.find((r) => r.id === ruleId)?.params);
  return (
    <section aria-labelledby="alerts-now-heading" className="panel grid gap-3">
      <h3 id="alerts-now-heading">Now</h3>
      {!status.deliveryEnabled && (
        <p className="text-warn">Delivery is off (shadow week): alerts are logged here but not sent to Discord.</p>
      )}
      {status.mutedUntil && (
        <p className="text-muted">
          Muted until <time dateTime={status.mutedUntil}>{formatTime(status.mutedUntil)}</time>: nothing is sent until then.
        </p>
      )}
      {status.firing.length === 0 ? (
        <p>Nothing is firing.</p>
      ) : (
        <ul aria-label="Firing now" className="grid gap-2">
          {status.firing.map((alert) => (
            <li key={`${alert.ruleId}:${alert.subject}`} className="grid gap-0.5">
              <span>
                <span className={cn("font-semibold", severityClass(alert.severity))}>{severityLabel(alert.severity)}</span>{" "}
                {alertTitle(alert.kind, alert.subject, itemFor(alert.ruleId))}
              </span>
              <span className="text-sm text-muted">
                Since <time dateTime={alert.since}>{formatTime(alert.since)}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Where alerts are sent. The webhook URL is a secret: only its last 4 characters ever arrive. */
export function DestinationPanel({ destinations }: { destinations: AlertDestinationsResponse }) {
  const discord = destinations.discord;
  const reason = discord ? disabledReasonText(discord.disabledReason) : null;
  return (
    <section aria-labelledby="alerts-destination-heading" className="panel grid gap-2">
      <h3 id="alerts-destination-heading">Discord</h3>
      {discord === null ? (
        <p>No Discord webhook is set, so alerts are only logged here.</p>
      ) : (
        <>
          <p>
            Webhook ending in <code>…{discord.last4}</code>:{" "}
            <span className={discord.enabled ? "text-ok" : "text-bad"}>{discord.enabled ? "on" : "off"}</span>
          </p>
          {reason && <p className="text-sm text-muted">{reason}</p>}
        </>
      )}
    </section>
  );
}

/** The alert log, newest first. Paging is the container's (`onOlder`). */
export function AlertLogPanel({
  events,
  hasOlder,
  loadingOlder,
  onOlder,
}: {
  events: readonly AlertEvent[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onOlder: () => void;
}) {
  return (
    <section aria-labelledby="alerts-log-heading" className="panel grid gap-3">
      <h3 id="alerts-log-heading">Alert log</h3>
      {events.length === 0 ? (
        <p>No alerts yet.</p>
      ) : (
        <ol aria-label="Alert log, newest first" className="grid gap-3">
          {events.map((event) => (
            <LogEntry key={event.id} event={event} />
          ))}
        </ol>
      )}
      {hasOlder && (
        <button type="button" className="justify-self-start" disabled={loadingOlder} onClick={onOlder}>
          {loadingOlder ? "Loading older alerts…" : "Show older alerts"}
        </button>
      )}
    </section>
  );
}

function LogEntry({ event }: { event: AlertEvent }) {
  const detail = eventDetail(event);
  const resolved = event.transition === "resolved";
  return (
    <li className="grid gap-0.5 border-l-2 border-line pl-3">
      <span className="text-sm text-muted">
        <time dateTime={event.at}>{formatTime(event.at)}</time> · {transitionLabel(event.transition)}
      </span>
      <span>
        <span className={cn("font-semibold", resolved ? "text-ok" : severityClass(event.severity))}>
          {resolved ? "Resolved" : severityLabel(event.severity)}
        </span>{" "}
        {alertTitle(event.kind, event.subject, itemOf(event.summary))}
      </span>
      {detail && <span className="text-sm">{detail}</span>}
    </li>
  );
}
