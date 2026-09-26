import { useId, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { AlertEvent, AlertStatusResponse } from "@satisfactory-dash/shared";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { formatTime } from "../format";
import { cn } from "../lib/cn";
import { useSelectedServer } from "../servers/ServerContext";
import { alertTitle, eventDetail, itemOf, severityClass, severityLabel, transitionLabel } from "./alertText";

/**
 * What the bell opens (the owner's design): what's firing first, then the recent log, each alert a
 * line that expands in place for its detail. The settings live on the Settings page ("Manage
 * alerts"). The log is read only while this is open (queries.alertEvents is never polled).
 */
export function AlertsMenu({ onNavigate }: { onNavigate: () => void }) {
  const server = useSelectedServer();
  const status = useQuery(queries.alertStatus(server.id));
  // Only to name the item a production alert is about; everything shows without it.
  const rules = useQuery(queries.alertRules(server.id));
  const log = useInfiniteQuery(queries.alertEvents(server.id));
  const itemFor = (ruleId: string) => itemOf(rules.data?.rules.find((r) => r.id === ruleId)?.params);

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base">Alerts</h2>
        <Link to="/app/settings#alerts" onClick={onNavigate} className="inline-flex min-h-touch items-center text-sm">
          Manage alerts
        </Link>
      </div>

      {status.data && <StatusNotes status={status.data} />}

      <section aria-label="Firing now" className="grid gap-2">
        <h3 className="text-sm text-muted">Firing now</h3>
        {status.isPending ? (
          <p role="status">Loading…</p>
        ) : !status.data ? (
          <ErrorNotice error={status.error} />
        ) : status.data.firing.length === 0 ? (
          <p>Nothing is firing.</p>
        ) : (
          <ul className="grid gap-1">
            {status.data.firing.map((alert) => (
              <li key={`${alert.ruleId}:${alert.subject}`}>
                <AlertLine
                  severity={alert.severity}
                  title={alertTitle(alert.kind, alert.subject, itemFor(alert.ruleId))}
                  meta={
                    <>
                      Since <time dateTime={alert.since}>{formatTime(alert.since)}</time>
                    </>
                  }
                >
                  <p>
                    {severityLabel(alert.severity)} since <time dateTime={alert.since}>{formatTime(alert.since)}</time>.
                  </p>
                </AlertLine>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Recent" className="grid gap-2">
        <h3 className="text-sm text-muted">Recent</h3>
        {log.isPending ? (
          <p role="status">Loading…</p>
        ) : !log.data ? (
          <ErrorNotice
            error={log.error}
            action={
              <button type="button" onClick={() => void log.refetch()}>
                Retry
              </button>
            }
          />
        ) : log.data.pages[0].events.length === 0 ? (
          <p>No alerts yet.</p>
        ) : (
          <ul className="grid gap-1">
            {log.data.pages
              .flatMap((page) => page.events)
              .map((event) => (
                <li key={event.id}>
                  <EventLine event={event} />
                </li>
              ))}
          </ul>
        )}
        {log.hasNextPage && (
          <button type="button" className="justify-self-start" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
            {log.isFetchingNextPage ? "Loading older alerts…" : "Show older alerts"}
          </button>
        )}
      </section>
    </div>
  );
}

function StatusNotes({ status }: { status: AlertStatusResponse }) {
  if (status.deliveryEnabled && !status.mutedUntil) return null;
  return (
    <div className="grid gap-1 text-sm">
      {!status.deliveryEnabled && <p className="text-warn">Delivery is off (shadow week): alerts are logged, not sent.</p>}
      {status.mutedUntil && (
        <p className="text-muted">
          Muted until <time dateTime={status.mutedUntil}>{formatTime(status.mutedUntil)}</time>.
        </p>
      )}
    </div>
  );
}

function EventLine({ event }: { event: AlertEvent }) {
  const resolved = event.transition === "resolved";
  const detail = eventDetail(event);
  return (
    <AlertLine
      severity={resolved ? "resolved" : event.severity}
      label={resolved ? "Resolved" : undefined}
      title={alertTitle(event.kind, event.subject, itemOf(event.summary))}
      meta={
        <>
          <time dateTime={event.at}>{formatTime(event.at)}</time> · {transitionLabel(event.transition)}
        </>
      }
    >
      {detail ? <p>{detail}</p> : <p className="text-muted">No more detail for this alert.</p>}
    </AlertLine>
  );
}

/**
 * One alert: a button showing its severity, title and time, which expands in place to show the
 * detail (a disclosure: aria-expanded, and the detail is the region it controls).
 */
function AlertLine({
  severity,
  label,
  title,
  meta,
  children,
}: {
  severity: string;
  label?: string;
  title: string;
  meta: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <div className="rounded-md border border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((o) => !o)}
        className="grid min-h-touch w-full gap-0.5 rounded-md border-0 bg-transparent px-3 py-2 text-left font-normal"
      >
        <span>
          <span className={cn("font-semibold", severity === "resolved" ? "text-ok" : severityClass(severity))}>
            {label ?? severityLabel(severity)}
          </span>{" "}
          {title}
        </span>
        <span className="text-sm text-muted">{meta}</span>
      </button>
      {open && (
        <div id={detailId} className="border-t border-line px-3 py-2 text-sm">
          {children}
        </div>
      )}
    </div>
  );
}
