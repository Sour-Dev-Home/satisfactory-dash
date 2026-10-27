import {
  METRICS_LAST_BUCKET_MS,
  type AlertQualityMonth,
  type CounterSummary,
  type HistogramSummary,
  type MetricLabels,
  type MetricsUnavailableReason,
  type MetricsWindow,
} from "@satisfactory-dash/shared";
import { kindLabel } from "../alerts/alertText";
import { formatDuration, formatPercent } from "../format";

/**
 * Words for the metrics page (ADR-0056). Pure, so the copy and the number rules are tested without a screen.
 * Every lookup keyed by a backend string is a Map with a readable fallback: a newer backend may add metrics.
 */

export const DEFAULT_METRICS_WINDOW: MetricsWindow = "24h";

export const WINDOW_LABEL: ReadonlyMap<MetricsWindow, { short: string; words: string }> = new Map([
  ["1h", { short: "1 h", words: "the last hour" }],
  ["24h", { short: "24 h", words: "the last 24 hours" }],
  ["7d", { short: "7 d", words: "the last 7 days" }],
]);

export function windowWords(window: MetricsWindow): string {
  return WINDOW_LABEL.get(window)?.words ?? window;
}

/** A bucket bound in ms as "200 ms" or "2 s". */
function boundText(ms: number): string {
  return ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`;
}

/**
 * A percentile as the bucket upper bound it is (ADR-0056 section 2): "≤ 200 ms". `null` is the open-ended last
 * bucket: "> 5 s". The data is coarse on purpose, so there is never an interpolated number.
 */
export function percentileText(ms: number | null): string {
  return ms === null ? `> ${boundText(METRICS_LAST_BUCKET_MS)}` : `≤ ${boundText(ms)}`;
}

/** A whole count with thousands separators, in fixed en-US so it reads the same everywhere. */
const countFormat = new Intl.NumberFormat("en-US");
export function countText(n: number): string {
  return countFormat.format(n);
}

/** "route /api/…, status_class 2xx" style detail: the labels in registry order, `name value`. Empty when there are none. */
export function labelsText(labels: MetricLabels): string {
  return Object.entries(labels)
    .map(([key, value]) => `${key.replaceAll("_", " ")} ${value}`)
    .join(", ");
}

const METRIC_NAME: ReadonlyMap<string, string> = new Map([
  ["http.server.request.duration", "Request"],
  ["http.server.upstream.duration", "Game server call"],
  ["db.client.operation.duration", "Database query"],
  ["satis.poller.cycle.duration", "Poll cycle time"],
  ["satis.poller.lag", "Poll lag"],
  ["satis.agent.ingest.lag", "Agent upload lag"],
  ["satis.alerts.evaluation.duration", "Alert check time"],
  ["satis.alerts.fire.lag", "Alert send lag"],
  ["satis.history.rows_written", "History rows written"],
  ["satis.history.rows_dropped", "History rows dropped"],
  ["satis.alerts.events_dropped", "Alert log entries dropped"],
  ["satis.alerts.push.dropped", "Push notifications dropped"],
  ["satis.agent.refused", "Agent uploads refused"],
  ["satis.signup.refused", "Sign-ups refused"],
  ["satis.servers.pending_swept", "Unfinished servers cleared"],
]);

/** A metric's plain name; one nobody here has named yet shows as its registry name. */
export function metricName(metric: string): string {
  return METRIC_NAME.get(metric) ?? metric;
}

/** The System section's latency tables, in reading order. A histogram in none of them lands in "Other timings". */
export interface HistogramGroup {
  id: string;
  title: string;
  metrics: readonly string[];
}

export const HISTOGRAM_GROUPS: readonly HistogramGroup[] = [
  { id: "requests", title: "Requests to the dashboard", metrics: ["http.server.request.duration"] },
  { id: "upstream", title: "Calls to the game server", metrics: ["http.server.upstream.duration"] },
  { id: "database", title: "Database queries", metrics: ["db.client.operation.duration"] },
  {
    id: "lag",
    title: "Polling, uploads and alerts",
    metrics: [
      "satis.poller.cycle.duration",
      "satis.poller.lag",
      "satis.agent.ingest.lag",
      "satis.alerts.evaluation.duration",
      "satis.alerts.fire.lag",
    ],
  },
];

const OTHER_TIMINGS: HistogramGroup = { id: "other", title: "Other timings", metrics: [] };

/** The histograms split into the groups above, empty groups left out, unknown metrics last. */
export function groupHistograms(histograms: readonly HistogramSummary[]): Array<HistogramGroup & { rows: HistogramSummary[] }> {
  const known = new Set(HISTOGRAM_GROUPS.flatMap((g) => g.metrics));
  const groups = [
    ...HISTOGRAM_GROUPS.map((group) => ({
      ...group,
      rows: histograms.filter((h) => group.metrics.includes(h.metric)),
    })),
    { ...OTHER_TIMINGS, rows: histograms.filter((h) => !known.has(h.metric)) },
  ];
  return groups.filter((g) => g.rows.length > 0);
}

/** Counters that count work done; every other counter counts something refused or dropped. */
const THROUGHPUT_COUNTERS: ReadonlySet<string> = new Set(["satis.history.rows_written"]);

export function splitCounters(counters: readonly CounterSummary[]): { throughput: CounterSummary[]; refused: CounterSummary[] } {
  return {
    throughput: counters.filter((c) => THROUGHPUT_COUNTERS.has(c.metric)),
    refused: counters.filter((c) => !THROUGHPUT_COUNTERS.has(c.metric)),
  };
}

/** The alert months newest first, then by kind, so the current month leads. */
export function sortAlertMonths(months: readonly AlertQualityMonth[]): AlertQualityMonth[] {
  return [...months].sort((a, b) => b.month.localeCompare(a.month) || a.kind.localeCompare(b.kind));
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10" as "October 2026". */
export function monthText(month: string): string {
  const [year, number] = month.split("-");
  const index = Number(number) - 1;
  const name = index >= 0 ? MONTH_NAMES.at(index) : undefined;
  return name === undefined ? month : `${name} ${year}`;
}

export function resolveText(seconds: number | null): string {
  return seconds === null ? "None resolved" : formatDuration(seconds);
}

export const alertKindText = kindLabel;

/** A 0 to 1 rate as a percentage; null (no denominator) is "n/a". */
export function rateText(rate: number | null): string {
  return rate === null ? "n/a" : formatPercent(rate * 100);
}

export function hoursText(hours: number | null): string {
  return hours === null ? "n/a" : `${Math.round(hours * 10) / 10} h`;
}

export type MetricsSectionName = "system" | "alerts" | "delivery";

const UNAVAILABLE: ReadonlyMap<string, string> = new Map([
  ["system:not_built", "System metrics aren't built into this backend yet."],
  ["system:no_data", "Nothing has been recorded in this window yet. Try a longer window, or check back in a minute: the numbers are saved once a minute."],
  ["system:not_configured", "System metrics are switched off on this backend."],
  ["alerts:not_built", "Alert quality isn't built into this backend yet."],
  ["alerts:no_data", "No alert fired in the last three months, so there is nothing to count yet."],
  ["alerts:not_configured", "Alert quality is switched off on this backend."],
  ["delivery:not_built", "Delivery figures aren't collected yet. The latency probe's runs and the status page are linked below."],
  ["delivery:no_data", "No delivery snapshot has arrived yet. The feed sends one a day."],
  ["delivery:not_configured", "The daily delivery feed isn't set up on this backend."],
]);

const CHARTS_UNAVAILABLE: ReadonlyMap<MetricsUnavailableReason, string> = new Map([
  ["not_built", "Charts not available yet: this backend doesn't draw them yet. The details below still have every number."],
  ["no_data", "Charts not available yet: nothing has been recorded in this window. The numbers are saved once a minute."],
  ["not_configured", "Charts not available yet: they are switched off on this backend."],
]);

/**
 * Why the headline and trend charts are missing (ADR-0056 amendment): `null` is an older backend that sends no
 * `charts` at all. The folded details still render either way.
 */
export function chartsUnavailableText(reason: MetricsUnavailableReason | null): string {
  return (reason && CHARTS_UNAVAILABLE.get(reason)) ?? "Charts not available yet. The details below still have every number.";
}

/** Why a section has nothing to show, in words (ADR-0056 section 2). */
export function unavailableText(section: MetricsSectionName, reason: MetricsUnavailableReason): string {
  return UNAVAILABLE.get(`${section}:${reason}`) ?? "There is nothing to show here.";
}
