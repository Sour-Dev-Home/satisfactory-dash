import { useMemo, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { AlertDestinationsResponse, AlertRule, AlertStatusResponse } from "@satisfactory-dash/shared";
import { useAlertWrites } from "../../api/alertWrites";
import { queries } from "../../api/queries";
import { ErrorNotice } from "../../components/ErrorNotice";
import { IS_DEMO } from "../../demo/mode";
import { itemLabels } from "../../factory/itemLabels";
import { formatTime } from "../../format";
import { cn } from "../../lib/cn";
import { useSelectedServer } from "../../servers/ServerContext";
import { alertTitle, canEditAlerts, disabledReasonText, itemOf, severityClass, severityLabel } from "../alertText";
import { RulesEditor } from "../rules/RulesEditor";
import type { EditorItem } from "../rules/ruleDraft";
import { DiscordControls } from "./DiscordControls";
import { MuteControl } from "./MuteControl";

/**
 * Settings → Alerts (ADR-0027 PR 9c): whether alerts go out and the mute, the Discord webhook, and
 * the rules. Every member reads it; owners and admins (the server's `role`, a UX hint only) get the
 * controls. Each part loads and fails on its own. Writes go only through useAlertWrites, and the
 * webhook only through saveWebhook. The header's alert dropdown links here (/app/settings#alerts).
 */
export function AlertSettings() {
  const server = useSelectedServer();
  const canEdit = canEditAlerts(server.role);
  const writes = useAlertWrites(server.id);
  const status = useQuery(queries.alertStatus(server.id));
  const destinations = useQuery(queries.alertDestinations(server.id));
  const rules = useQuery(queries.alertRules(server.id));
  return (
    <section id="alerts" aria-labelledby="alert-settings-heading" className="panel grid gap-5">
      <h3 id="alert-settings-heading">Alerts</h3>

      <Part heading="Status" query={status} loading="Loading alert status…">
        {(data) => (
          <>
            <Status status={data} rules={rules.data?.rules} />
            {canEdit && (
              <MuteControl
                mutedUntil={data.mutedUntil}
                onMute={(until) => writes.setMute.mutateAsync(until)}
                onUnmute={() => writes.clearMute.mutateAsync()}
              />
            )}
          </>
        )}
      </Part>

      <Part heading="Discord" query={destinations} loading="Loading the Discord setup…">
        {(data) => (
          <>
            <Destination destinations={data} />
            {canEdit && (
              <DiscordControls
                discord={data.discord}
                demo={IS_DEMO}
                onSave={writes.saveWebhook}
                onToggle={(enabled) => writes.patchDiscord.mutateAsync(enabled)}
                onRemove={() => writes.removeDiscord.mutateAsync()}
                onTest={() => writes.testDiscord.mutateAsync()}
              />
            )}
          </>
        )}
      </Part>

      <Part heading="Rules" query={rules} loading="Loading the alert rules…">
        {(data) => (
          <Rules
            serverId={server.id}
            rules={data.rules}
            canEdit={canEdit}
            onCreate={(body) => writes.createRule.mutateAsync(body)}
            onUpdate={(ruleId, body) => writes.updateRule.mutateAsync({ ruleId, body })}
            onDelete={(ruleId) => writes.deleteRule.mutateAsync(ruleId)}
          />
        )}
      </Part>
    </section>
  );
}

/** One part of the section: its heading, then its data, its loading line or its error with Retry. */
function Part<T>({
  heading,
  query,
  loading,
  children,
}: {
  heading: string;
  query: UseQueryResult<T>;
  loading: string;
  children: (data: T) => ReactNode;
}) {
  const id = `alert-settings-${heading.toLowerCase()}`;
  return (
    <div role="group" aria-labelledby={id} className="grid gap-3">
      <h4 id={id} className="mb-0">
        {heading}
      </h4>
      {query.isPending ? (
        <p role="status" className="mb-0">
          {loading}
        </p>
      ) : !query.data ? (
        <ErrorNotice
          error={query.error}
          action={
            <button type="button" onClick={() => void query.refetch()}>
              Retry
            </button>
          }
        />
      ) : (
        children(query.data)
      )}
    </div>
  );
}

/** Whether alerts go out, the mute, and what's firing. `rules` names a production alert's item. */
function Status({ status, rules }: { status: AlertStatusResponse; rules?: readonly AlertRule[] }) {
  const itemFor = (ruleId: string) => itemOf(rules?.find((r) => r.id === ruleId)?.params);
  return (
    <div className="grid gap-2">
      {!status.deliveryEnabled && (
        <p className="mb-0 text-warn">Delivery is off (shadow week): alerts are logged but not sent to Discord.</p>
      )}
      {status.mutedUntil && (
        <p className="mb-0 text-muted">
          Muted until <time dateTime={status.mutedUntil}>{formatTime(status.mutedUntil)}</time>: nothing is sent until then.
        </p>
      )}
      {status.firing.length === 0 ? (
        <p className="mb-0">Nothing is firing.</p>
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
    </div>
  );
}

/** Where alerts are sent. The webhook URL is a secret: only its last 4 characters ever arrive. */
function Destination({ destinations }: { destinations: AlertDestinationsResponse }) {
  const discord = destinations.discord;
  const reason = discord ? disabledReasonText(discord.disabledReason) : null;
  if (discord === null) return <p className="mb-0">No Discord webhook is set, so alerts are only logged.</p>;
  return (
    <div className="grid gap-1">
      <p className="mb-0">
        Webhook ending in <code>…{discord.last4}</code>:{" "}
        <span className={discord.enabled ? "text-ok" : "text-bad"}>{discord.enabled ? "on" : "off"}</span>
      </p>
      {reason && <p className="mb-0 text-sm text-muted">{reason}</p>}
    </div>
  );
}

/**
 * The rules editor, with the items the factory makes today to pick a production target from (names
 * and units, as on the Factory page). Without the factory it still works: a production rule's item
 * falls back to its readable class name.
 */
function Rules({ serverId, ...editor }: { serverId: string } & Omit<Parameters<typeof RulesEditor>[0], "items">) {
  const factory = useQuery(queries.factory(serverId));
  const buildings = factory.data?.data.buildings;
  const items = useMemo<EditorItem[]>(
    () => [...itemLabels(buildings ?? [])].map(([className, label]) => ({ className, ...label })),
    [buildings],
  );
  return <RulesEditor {...editor} items={items} />;
}
