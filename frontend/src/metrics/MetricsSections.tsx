import { useId, type ReactNode } from "react";
import type {
  CounterSummary,
  DeliverySnapshot,
  HistogramSummary,
  MetricsOverview,
  ServerMetricSummary,
} from "@satisfactory-dash/shared";
import { formatTime } from "../format";
import { HeadlineRow, TrendGroup } from "./MetricsCharts";
import { alertsChartSpec, chartsData, systemChartSpecs, trendCaption } from "./metricsTrend";
import {
  alertKindText,
  countText,
  groupHistograms,
  hoursText,
  labelsText,
  metricName,
  monthText,
  percentileText,
  rateText,
  resolveText,
  sortAlertMonths,
  splitCounters,
  unavailableText,
  type MetricsSectionName,
} from "./metricsText";

/**
 * The metrics page's sections (ADR-0056 section 1), each a `.panel`: they show data or say why there is none
 * (not built, nothing recorded, switched off). Presentational: schema types in, markup out. Since the chart-led
 * amendment (2026-10-26) a panel's tables are folded "Details" under its charts: the accessible text path, where every
 * number is text and a percentile is the bucket bound it is ("≤ 200 ms"). A reason for having no data is never folded.
 */

/**
 * A section's frame: heading, its charts, then the body. With `fold`, the "as of" line, intro and body sit in a closed
 * `<details>` whose summary is `fold`.
 */
function Panel({
  title,
  asOf,
  intro,
  charts,
  fold,
  children,
}: {
  title: string;
  asOf?: string;
  intro?: ReactNode;
  charts?: ReactNode;
  fold?: string;
  children: ReactNode;
}) {
  const id = useId();
  const body = (
    <>
      {asOf && <p className="mb-0 text-sm text-muted">As of {formatTime(asOf)}.</p>}
      {intro}
      {children}
    </>
  );
  return (
    <section aria-labelledby={id} className="panel">
      <h3 id={id}>{title}</h3>
      {charts}
      {fold ? (
        <details data-details="" className="group">
          <summary className="flex min-h-touch cursor-pointer items-center gap-2 text-fg">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="disclosure-chevron size-chevron flex-none group-open:rotate-90">
              <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
            {fold}
          </summary>
          <div className="grid gap-3 pt-2">{body}</div>
        </details>
      ) : (
        body
      )}
    </section>
  );
}

function Unavailable({ section, reason }: { section: MetricsSectionName; reason: Parameters<typeof unavailableText>[1] }) {
  return (
    <p data-unavailable={reason} className="mb-0 text-muted">
      {unavailableText(section, reason)}
    </p>
  );
}

function SubHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h4 id={id} className="mb-0">
      {children}
    </h4>
  );
}

function LatencyTable({ id, rows, showMetric }: { id: string; rows: readonly HistogramSummary[]; showMetric: boolean }) {
  return (
    <table aria-labelledby={id}>
      <thead>
        <tr>
          <th scope="col">What</th>
          <th scope="col">Count</th>
          <th scope="col">p50</th>
          <th scope="col">p95</th>
          <th scope="col">p99</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.metric}:${labelsText(row.labels)}:${i}`}>
            <th scope="row" data-label="What">
              {[showMetric ? metricName(row.metric) : "", labelsText(row.labels)].filter(Boolean).join(", ") || "All"}
            </th>
            <td data-label="Count">{countText(row.count)}</td>
            <td data-label="p50">{percentileText(row.p50Ms)}</td>
            <td data-label="p95">{percentileText(row.p95Ms)}</td>
            <td data-label="p99">{percentileText(row.p99Ms)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CounterTable({ id, rows }: { id: string; rows: readonly CounterSummary[] }) {
  return (
    <table aria-labelledby={id}>
      <thead>
        <tr>
          <th scope="col">What</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.metric}:${labelsText(row.labels)}:${i}`}>
            <th scope="row" data-label="What">
              {metricName(row.metric)}
              {labelsText(row.labels) ? `, ${labelsText(row.labels)}` : ""}
            </th>
            <td data-label="Total">{countText(row.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ServerRows({ id, rows }: { id: string; rows: readonly ServerMetricSummary[] }) {
  return (
    <table aria-labelledby={id}>
      <thead>
        <tr>
          <th scope="col">Server</th>
          <th scope="col">What</th>
          <th scope="col">Result</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.kind}:${row.metric}:${row.server}:${labelsText(row.labels)}:${i}`}>
            <th scope="row" data-label="Server">
              {row.server}
            </th>
            <td data-label="What">
              {metricName(row.metric)}
              {labelsText(row.labels) ? `, ${labelsText(row.labels)}` : ""}
            </td>
            <td data-label="Result">
              {row.kind === "histogram"
                ? `p95 ${percentileText(row.p95Ms)} over ${countText(row.count)}`
                : `${countText(row.total)} in total`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SystemSection({ system, charts }: { system: MetricsOverview["system"]; charts?: ReactNode }) {
  const id = useId();
  if (!system.available) {
    return (
      <Panel title="System" charts={charts}>
        <Unavailable section="system" reason={system.reason} />
      </Panel>
    );
  }
  const groups = groupHistograms(system.histograms);
  const { throughput, refused } = splitCounters(system.counters);
  const empty = groups.length === 0 && system.counters.length === 0;
  return (
    <Panel
      title="System"
      charts={charts}
      fold="System details: every timing and counter"
      asOf={system.asOf}
      intro={
        <p className="mb-0 text-sm text-muted">
          Timings are bucket upper bounds: "p95 ≤ 200 ms" means 95 of 100 took 200 ms or less, not exactly 200. "&gt; 5 s" is
          slower than the largest bucket. All servers are combined.
        </p>
      }
    >
      {empty && <Unavailable section="system" reason="no_data" />}
      {groups.map((group) => (
        <div key={group.id} className="grid gap-2">
          <SubHeading id={`${id}-${group.id}`}>{group.title}</SubHeading>
          <LatencyTable id={`${id}-${group.id}`} rows={group.rows} showMetric={group.metrics.length !== 1} />
        </div>
      ))}
      {throughput.length > 0 && (
        <div className="grid gap-2">
          <SubHeading id={`${id}-throughput`}>Work done</SubHeading>
          <CounterTable id={`${id}-throughput`} rows={throughput} />
        </div>
      )}
      {refused.length > 0 && (
        <div className="grid gap-2">
          <SubHeading id={`${id}-refused`}>Refused and dropped</SubHeading>
          <CounterTable id={`${id}-refused`} rows={refused} />
        </div>
      )}
      {system.servers.length > 0 && (
        <div className="grid gap-2">
          <SubHeading id={`${id}-servers`}>Servers with the most to look at (by public id)</SubHeading>
          <ServerRows id={`${id}-servers`} rows={system.servers} />
        </div>
      )}
    </Panel>
  );
}

export function AlertsSection({ alerts, charts }: { alerts: MetricsOverview["alerts"]; charts?: ReactNode }) {
  const id = useId();
  if (!alerts.available) {
    return (
      <Panel title="Alert quality" charts={charts}>
        <Unavailable section="alerts" reason={alerts.reason} />
      </Panel>
    );
  }
  const months = sortAlertMonths(alerts.months);
  return (
    <Panel
      title="Alert quality"
      charts={charts}
      fold="Alert quality details: by month and kind"
      asOf={alerts.asOf}
      intro={
        <p className="mb-0 text-sm text-muted">
          The last three months, all servers together. A flap is an alert that fired and cleared within 5 minutes. Until false
          alarms can be marked, flaps are the stand-in for them.
        </p>
      }
    >
      {months.length === 0 ? (
        <Unavailable section="alerts" reason="no_data" />
      ) : (
        <table aria-labelledby={id}>
          <caption id={id} className="sr-only">
            Alerts fired, flaps and median time to resolve, by month and kind
          </caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Alert</th>
              <th scope="col">Fired</th>
              <th scope="col">Flaps</th>
              <th scope="col">Median time to resolve</th>
            </tr>
          </thead>
          <tbody>
            {months.map((row) => (
              <tr key={`${row.month}:${row.kind}`}>
                <th scope="row" data-label="Month">
                  {monthText(row.month)}
                </th>
                <td data-label="Alert">{alertKindText(row.kind)}</td>
                <td data-label="Fired">{countText(row.fired)}</td>
                <td data-label="Flaps">{countText(row.flaps)}</td>
                <td data-label="Median time to resolve">{resolveText(row.medianResolveSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function DeliveryTable({ id, snapshot }: { id: string; snapshot: DeliverySnapshot }) {
  const { throughput, leadTimeHours, size, changeFailure, ci } = snapshot;
  const rows: Array<[string, string]> = [
    ["Pull requests merged", `${countText(throughput.mergedPrs)} (${Math.round(throughput.perDay * 10) / 10} a day)`],
    ["Lead time, median", hoursText(leadTimeHours.median)],
    ["Lead time, 90th percentile", hoursText(leadTimeHours.p90)],
    ["Median change size", size.medianLinesChanged === null ? "n/a" : `${countText(size.medianLinesChanged)} lines`],
    ["Main builds that failed", `${rateText(changeFailure.failureRate)} of ${countText(changeFailure.mainRuns)}`],
    ["Reverts", `${countText(changeFailure.revertPrs)} (${rateText(changeFailure.revertRate)})`],
    ["Flaky CI runs", `${countText(ci.flakyRuns)} (${rateText(ci.flakeRate)})`],
    ["Pull requests that failed a check before merging", `${countText(ci.prsBounced)} of ${countText(ci.prsMerged)} (${rateText(ci.bounceRate)})`],
  ];
  return (
    <table aria-labelledby={id}>
      <thead>
        <tr>
          <th scope="col">Measure</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, value]) => (
          <tr key={name}>
            <th scope="row" data-label="Measure">
              {name}
            </th>
            <td data-label="Value">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DeliverySection({ delivery }: { delivery: MetricsOverview["delivery"] }) {
  const id = useId();
  if (!delivery.available) {
    return (
      <Panel title="Delivery and CI">
        <Unavailable section="delivery" reason={delivery.reason} />
      </Panel>
    );
  }
  return (
    <Panel
      title="Delivery and CI"
      fold="Delivery details: throughput, lead time and build health"
      asOf={delivery.asOf}
      intro={<p className="mb-0 text-sm text-muted">The last {delivery.snapshot.window.days} days of the repository, counted once a day.</p>}
    >
      <SubHeading id={id}>Throughput, lead time and build health</SubHeading>
      <DeliveryTable id={id} snapshot={delivery.snapshot} />
    </Panel>
  );
}

/** Where the numbers this page doesn't hold live: the public status page and the probe's runs. */
export function LinksSection({ links }: { links: MetricsOverview["links"] }) {
  return (
    <Panel title="Elsewhere" fold="Links: uptime and the latency probe">
      <ul className="mb-0 grid gap-2 pl-5">
        <li>
          <a href={links.statusPage} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-touch items-center">
            Public status page (uptime)<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
        <li>
          <a href={links.probeRuns} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-touch items-center">
            Latency probe runs on GitHub<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      </ul>
    </Panel>
  );
}

/**
 * All the sections in page order (Grafana's stat row, then trends, then detail): the headline row, the System charts
 * over their folded tables, the alerts chart over alert quality, then delivery and the links.
 */
export function MetricsSections({ overview }: { overview: MetricsOverview }) {
  const charts = chartsData(overview);
  const caption = charts ? trendCaption(charts.trend) : "";
  return (
    <>
      <HeadlineRow overview={overview} />
      <SystemSection
        system={overview.system}
        charts={charts && <TrendGroup trend={charts.trend} specs={systemChartSpecs(charts.trend)} caption={caption} />}
      />
      <AlertsSection
        alerts={overview.alerts}
        charts={charts && <TrendGroup trend={charts.trend} specs={[alertsChartSpec(charts.trend)]} caption={caption} />}
      />
      <DeliverySection delivery={overview.delivery} />
      <LinksSection links={overview.links} />
    </>
  );
}
