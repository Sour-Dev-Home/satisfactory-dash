import { useMemo, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAlertWrites } from "../api/alertWrites";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { IS_DEMO } from "../demo/mode";
import { itemLabels } from "../factory/itemLabels";
import { useSelectedServer } from "../servers/ServerContext";
import { canEditAlerts } from "./alertText";
import { AlertLogPanel, AlertStatusPanel, DestinationPanel } from "./AlertsPanels";
import { DiscordControls } from "./DiscordControls";
import { MuteControl } from "./MuteControl";
import { RulesEditor } from "./rules/RulesEditor";
import type { EditorItem } from "./rules/ruleDraft";

/**
 * The Alerts page (ADR-0027 PR 9), opened from the header bell. Each part loads and fails on its
 * own, so a broken log never hides what's firing. Owners and admins also get the controls (9c):
 * the mute, the Discord setup and the rules. The role is a UX hint only: a viewer's write answers
 * 403, which each control shows like any other error.
 */
export function AlertsView() {
  const server = useSelectedServer();
  const canEdit = canEditAlerts(server.role);
  const writes = useAlertWrites(server.id);
  const status = useQuery(queries.alertStatus(server.id));
  const destinations = useQuery(queries.alertDestinations(server.id));
  const rules = useQuery(queries.alertRules(server.id));
  return (
    <div className="grid gap-5">
      <Loaded query={status} loading="Loading alert status…">
        {(data) => (
          <AlertStatusPanel status={data} rules={rules.data?.rules}>
            {canEdit && (
              <MuteControl
                mutedUntil={data.mutedUntil}
                onMute={(until) => writes.setMute.mutateAsync(until)}
                onUnmute={() => writes.clearMute.mutateAsync()}
              />
            )}
          </AlertStatusPanel>
        )}
      </Loaded>
      <Loaded query={destinations} loading="Loading the Discord setup…">
        {(data) => (
          <DestinationPanel destinations={data}>
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
          </DestinationPanel>
        )}
      </Loaded>
      <section aria-labelledby="alerts-rules-heading" className="panel grid gap-3">
        <h3 id="alerts-rules-heading">Rules</h3>
        <Loaded query={rules} loading="Loading the alert rules…">
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
        </Loaded>
      </section>
      <AlertLog serverId={server.id} />
    </div>
  );
}

/**
 * The rules editor, with the items the factory makes today to pick a production target from
 * (names and units, as on the Factory page). Without the factory the editor still works: a
 * production rule's item falls back to its readable class name.
 */
function Rules({ serverId, ...editor }: { serverId: string } & Omit<Parameters<typeof RulesEditor>[0], "items">) {
  const factory = useQuery({ ...queries.factory(serverId), enabled: editor.canEdit || editor.rules.length > 0 });
  const buildings = factory.data?.data.buildings;
  const items = useMemo<EditorItem[]>(
    () => [...itemLabels(buildings ?? [])].map(([className, label]) => ({ className, ...label })),
    [buildings],
  );
  return <RulesEditor {...editor} items={items} />;
}

function AlertLog({ serverId }: { serverId: string }) {
  const log = useInfiniteQuery(queries.alertEvents(serverId));
  if (log.isPending) return <p role="status">Loading the alert log…</p>;
  if (!log.data) return <Failed error={log.error} retry={() => void log.refetch()} />;
  return (
    <AlertLogPanel
      events={log.data.pages.flatMap((page) => page.events)}
      hasOlder={log.hasNextPage}
      loadingOlder={log.isFetchingNextPage}
      onOlder={() => void log.fetchNextPage()}
    />
  );
}

function Loaded<T>({ query, loading, children }: { query: UseQueryResult<T>; loading: string; children: (data: T) => ReactNode }) {
  if (query.isPending) return <p role="status">{loading}</p>;
  if (!query.data) return <Failed error={query.error} retry={() => void query.refetch()} />;
  return children(query.data);
}

function Failed({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ErrorNotice
      error={error}
      action={
        <button type="button" onClick={retry}>
          Retry
        </button>
      }
    />
  );
}
