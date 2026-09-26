import { useId, useState, type FormEvent } from "react";
import type { AlertRule, UpdateAlertRuleRequest } from "@satisfactory-dash/shared";
import { KNOWN_SEVERITIES } from "@satisfactory-dash/shared";
import { ErrorNotice } from "../../components/ErrorNotice";
import { labelFor, type ItemLabel } from "../../factory/itemLabels";
import { formatAmount, unitLabel } from "../../format";
import { fieldAttrs } from "./fieldAttrs";
import { FormField } from "./FormField";
import {
  buildUpdate,
  draftFrom,
  FIELD_HINT,
  kindLabel,
  knownParams,
  minutesText,
  severityLabel,
  type Draft,
  type Errors,
  type Field,
} from "./ruleDraft";

/** Kinds that fire on an edge: "for" is normally 0 there, so the field says what 0 means. */
const EDGE_KINDS = new Set(["power_outage", "fuse_trip"]);
const ITEM_NOTE = "To watch another item, delete this rule and create a new one.";

/** One rule: its settings as fields (owner/admin) or as text (members), with Save and, for non-presets, Delete. */
export function RuleCard({
  rule,
  items,
  canEdit,
  onUpdate,
  onDelete,
}: {
  rule: AlertRule;
  items: Map<string, ItemLabel>;
  canEdit: boolean;
  onUpdate: (id: string, request: UpdateAlertRuleRequest) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const uid = useId();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(rule));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const params = knownParams(rule);
  const item = rule.kind === "production_below_target" && params?.item ? labelFor(items, params.item) : null;
  const headingId = `${uid}-heading`;
  const fieldId = (f: Field | "enabled") => `${uid}-${f}`;
  // Changed = something to send (or an error to show): the same test Save uses, so "5.0" for 5 isn't a change.
  const changed = buildUpdate(rule, draft) !== null;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setParam = (f: Field, value: string) => setDraft((d) => ({ ...d, params: { ...d.params, [f]: value } }));

  async function save(e: FormEvent) {
    e.preventDefault();
    const built = buildUpdate(rule, draft);
    if (built === null) return;
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    setSaving(true);
    try {
      // On success the parent passes the saved rule, and this card resets from it (keyed by updatedAt).
      await onUpdate(rule.id, built.request);
    } catch (error) {
      setFailure(error); // the draft stays as the user left it
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setFailure(null);
    setDeleting(true);
    try {
      await onDelete(rule.id);
    } catch (error) {
      setFailure(error);
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  }

  const minutes = (f: "forMinutes" | "clearMinutes" | "repeatMinutes", label: string, hint: string) => (
    <FormField id={fieldId(f)} label={label} hint={hint} error={errors[f]}>
      <input
        {...fieldAttrs(fieldId(f), hint, errors[f])}
        inputMode="decimal"
        value={draft[f]}
        onChange={(e) => set(f, e.target.value)}
      />
    </FormField>
  );
  const param = (f: Field, label: string, hint: string, inputMode: "decimal" | "numeric" = "decimal") => (
    <FormField id={fieldId(f)} label={label} hint={hint} error={errors[f]}>
      <input
        {...fieldAttrs(fieldId(f), hint, errors[f])}
        inputMode={inputMode}
        value={draft.params[f] ?? ""}
        onChange={(e) => setParam(f, e.target.value)}
      />
    </FormField>
  );

  return (
    <article aria-labelledby={headingId} className="grid gap-3 rounded-card border border-line bg-surface p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 id={headingId} className="mb-0">
          {kindLabel(rule.kind)}
          {item && <span className="font-normal text-muted"> · {item.name}</span>}
        </h4>
        {rule.preset && <span className="text-sm text-muted">Preset: can be turned off, not deleted.</span>}
      </header>

      {!canEdit ? (
        <ReadOnly rule={rule} item={item} />
      ) : (
        <form onSubmit={save} noValidate aria-label={`${kindLabel(rule.kind)} settings`} className="grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            Enabled
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField id={fieldId("severity")} label="Severity" error={errors.severity}>
              <select
                {...fieldAttrs(fieldId("severity"), undefined, errors.severity, "select")}
                value={draft.severity}
                onChange={(e) => set("severity", e.target.value)}
              >
                {KNOWN_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {severityLabel(s)}
                  </option>
                ))}
                {/* A severity from a newer backend: shown as it is, kept unless changed. */}
                {!(KNOWN_SEVERITIES as readonly string[]).includes(rule.severity) && (
                  <option value={rule.severity}>{rule.severity}</option>
                )}
              </select>
            </FormField>
            {minutes("forMinutes", "Fire after (min)", EDGE_KINDS.has(rule.kind) ? "0 = at once." : FIELD_HINT.forMinutes)}
            {minutes("clearMinutes", "Clear after (min)", FIELD_HINT.clearMinutes)}
            {minutes("repeatMinutes", "Repeat every (min)", FIELD_HINT.repeatMinutes)}
          </div>

          {rule.kind === "stopped_machines" && params && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {param("stoppedBelowPercent", "Stopped below (%)", FIELD_HINT.stoppedBelowPercent)}
            </div>
          )}
          {rule.kind === "server_unreachable" && params && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {param("failedPolls", "Failed polls in a row", FIELD_HINT.failedPolls, "numeric")}
              {param("minMinutes", "For at least (min)", FIELD_HINT.minMinutes)}
            </div>
          )}
          {rule.kind === "production_below_target" && params && item && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="grid content-start gap-1.5 text-sm">
                {/* Styled like the fields' <label>s (muted), so it reads as a label over its value. */}
                <span className="text-muted">Item</span>
                <span className="text-fg-strong">{item.name}</span>
                <span className="text-muted">{ITEM_NOTE}</span>
              </div>
              {param("targetPerMinute", `Target (${unitLabel(item.unit)})`, FIELD_HINT.targetPerMinute)}
              {param("windowMinutes", "Averaged over (min)", FIELD_HINT.windowMinutes)}
            </div>
          )}

          {failure !== null && <ErrorNotice error={failure} />}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={saving || !changed}>
              {saving ? "Saving…" : "Save"}
            </button>
            {!rule.preset &&
              (confirming ? (
                <span role="group" aria-label="Confirm delete" className="flex flex-wrap items-center gap-2 text-sm">
                  Delete this rule?
                  <button type="button" onClick={() => void remove()} disabled={deleting}>
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} disabled={deleting}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirming(true)}>
                  Delete rule
                </button>
              ))}
          </div>
        </form>
      )}
    </article>
  );
}

/** The same settings as text, with the same labels, for members (who can read but not change them). */
function ReadOnly({ rule, item }: { rule: AlertRule; item: ItemLabel | null }) {
  const params = knownParams(rule);
  const rows: [string, string][] = [
    ["Enabled", rule.enabled ? "Yes" : "No"],
    ["Severity", severityLabel(rule.severity)],
    ["Fire after", EDGE_KINDS.has(rule.kind) && rule.forSeconds === 0 ? "0 min (at once)" : minutesText(rule.forSeconds)],
    ["Clear after", minutesText(rule.clearSeconds)],
    ["Repeat every", minutesText(rule.repeatSeconds)],
  ];
  if (rule.kind === "stopped_machines" && params) rows.push(["Stopped below", `${params.stoppedBelowPercent} %`]);
  if (rule.kind === "server_unreachable" && params) {
    rows.push(["Failed polls in a row", params.failedPolls ?? ""], ["For at least", `${params.minMinutes} min`]);
  }
  if (rule.kind === "production_below_target" && params && item) {
    rows.push(
      ["Item", item.name],
      ["Target", `${formatAmount(Number(params.targetPerMinute))} ${unitLabel(item.unit)}`],
      ["Averaged over", `${params.windowMinutes} min`],
    );
  }
  return (
    <>
      {/* Label and value stay on one line at any width, like the app's other definition lists. */}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted">{term}</dt>
            <dd className="mb-0 text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      {item && <p className="mb-0 text-sm text-muted">{ITEM_NOTE}</p>}
    </>
  );
}
