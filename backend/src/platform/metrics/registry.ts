/**
 * ADR-0037 decision 1: the fixed metric registry. A metric that isn't listed here can't be
 * recorded, and every label key and value comes from a closed set (a fixed list of values, or a
 * check that the value can only ever be a bounded, non-personal token: a route pattern with
 * parameter names, not the concrete URL a client sent; a status class; a short, code-chosen name).
 * This is the one place that decides "safe to record" — `aggregator.ts` calls `validate` before it
 * ever touches a label, so a bug elsewhere (a stray query string, a user id) is refused here rather
 * than reaching Postgres. Names follow OpenTelemetry semantic conventions where one exists, so a
 * later exporter is a mapping, not a rewrite (ADR-0037 §4).
 *
 * Only `http.server.request.duration` is wired to a recorder in this PR (ADR-0037 build order #2).
 * The rest of the table is registered now so PRs 3-4 slot into an already-fixed shape instead of
 * each inventing its own ad hoc metric name.
 */

export type MetricKind = "histogram" | "counter";

/** A label's check on the exact string it will be recorded with. */
export type LabelCheck = (value: string) => boolean;

export interface MetricDefinition {
  kind: MetricKind;
  /** Every label key this metric may carry. Recording a key outside this set is refused; every key
   *  listed here must be present on every recording (a metric never has an "optional" label — a
   *  missing one would silently widen the effective label set instead of failing loudly). */
  labels: Record<string, LabelCheck>;
}

export class UnknownMetricError extends Error {
  constructor(metric: string) {
    super(`Unknown metric "${metric}": it is not in the ADR-0037 registry.`);
    this.name = "UnknownMetricError";
  }
}

export class InvalidLabelError extends Error {
  constructor(metric: string, reason: string) {
    super(`Refusing to record "${metric}": ${reason}.`);
    this.name = "InvalidLabelError";
  }
}

const STATUS_CLASS = /^[1-5]xx$/;
export const isStatusClass: LabelCheck = (value) => STATUS_CLASS.test(value);

/** A short code-chosen token: never empty, never long enough to be a stray payload, and never
 *  containing characters a URL, an email or a free-text field would (whitespace, "?", "<", ">",
 *  "@"). Route patterns, query names and server public ids all satisfy this by construction. */
export const isBoundedToken =
  (maxLength: number): LabelCheck =>
  (value) =>
    value.length > 0 && value.length <= maxLength && !/[\s?<>@]/.test(value);

export const isOneOf =
  (...allowed: string[]): LabelCheck =>
  (value) =>
    allowed.includes(value);

/** ADR-0037 §1's table, in order. */
export const METRIC_REGISTRY: Readonly<Record<string, MetricDefinition>> = Object.freeze({
  "http.server.request.duration": {
    kind: "histogram",
    labels: { route: isBoundedToken(200), status_class: isStatusClass },
  },
  "http.server.upstream.duration": {
    kind: "histogram",
    labels: { api: isOneOf("vanilla", "frm") },
  },
  "db.client.operation.duration": {
    kind: "histogram",
    labels: { query: isBoundedToken(200) },
  },
  "satis.poller.cycle.duration": {
    kind: "histogram",
    labels: { server: isBoundedToken(64), group: isBoundedToken(64) },
  },
  "satis.poller.lag": {
    kind: "histogram",
    labels: { server: isBoundedToken(64), group: isBoundedToken(64) },
  },
  "satis.agent.ingest.lag": {
    kind: "histogram",
    labels: { server: isBoundedToken(64) },
  },
  "satis.history.rows_written": {
    kind: "counter",
    labels: { table: isBoundedToken(64) },
  },
  "satis.alerts.evaluation.duration": {
    kind: "histogram",
    labels: {},
  },
  "satis.alerts.fire.lag": {
    kind: "histogram",
    labels: { kind: isBoundedToken(64) },
  },
});

/** Throws `UnknownMetricError` or `InvalidLabelError`; returns the definition otherwise, so a
 *  caller that already looked it up (the aggregator) doesn't look it up twice. */
export function validateRecording(
  metric: string,
  kind: MetricKind,
  labels: Readonly<Record<string, string>>,
): MetricDefinition {
  // Object.hasOwn, not `METRIC_REGISTRY[metric]` / `in`: METRIC_REGISTRY (and every `labels`
  // object below) is a plain object, so a metric or label key that collides with something
  // Object.prototype already has (`toString`, `constructor`, `__proto__`, ...) is truthy / "in"
  // via the prototype chain even though it was never registered. A metric string picked that way
  // must still be refused as unknown, and a label key picked that way must still be refused as
  // undeclared — not silently treated as present with no check run against its value at all.
  if (!Object.hasOwn(METRIC_REGISTRY, metric)) {
    throw new UnknownMetricError(metric);
  }
  const definition = METRIC_REGISTRY[metric];
  if (definition.kind !== kind) {
    throw new InvalidLabelError(metric, `recorded as a ${kind}, but the registry declares it a ${definition.kind}`);
  }
  const declaredKeys = Object.keys(definition.labels);
  const givenKeys = Object.keys(labels);
  for (const key of givenKeys) {
    if (!Object.hasOwn(definition.labels, key)) {
      throw new InvalidLabelError(metric, `label "${key}" is not declared for this metric`);
    }
  }
  for (const key of declaredKeys) {
    const value = labels[key];
    if (value === undefined) {
      throw new InvalidLabelError(metric, `label "${key}" is required but was not given`);
    }
    if (!definition.labels[key](value)) {
      throw new InvalidLabelError(metric, `label "${key}" value "${value}" is outside its allowed set`);
    }
  }
  return definition;
}
