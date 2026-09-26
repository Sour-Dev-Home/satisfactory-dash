import { useId, useState, type FormEvent } from "react";
import { KNOWN_SEVERITIES, type CreateAlertRuleRequest } from "@satisfactory-dash/shared";
import { ErrorNotice } from "../../components/ErrorNotice";
import { severityLabel } from "../alertText";
import { unitLabel } from "../../format";
import { fieldAttrs } from "./fieldAttrs";
import { FormField } from "./FormField";
import { buildCreate, FIELD_HINT, NEW_TARGET, type EditorItem, type Errors, type NewTargetDraft } from "./ruleDraft";

/**
 * Create a "production below target" rule, the one kind that isn't a preset (ADR-0027 amendment 3):
 * an item, a target per minute in its unit, and the window it's averaged over. The contract's
 * defaults fill in the timing; the form resets once the rule is created.
 */
export function NewTargetForm({
  items,
  onCreate,
}: {
  /** Sorted by name, as the picker shows them. */
  items: EditorItem[];
  onCreate: (request: CreateAlertRuleRequest) => Promise<unknown>;
}) {
  const uid = useId();
  const [draft, setDraft] = useState<NewTargetDraft>(NEW_TARGET);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const set = (key: keyof NewTargetDraft, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const id = (f: keyof NewTargetDraft) => `${uid}-${f}`;
  const unit = items.find((i) => i.className === draft.item)?.unit ?? null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const built = buildCreate(draft);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    setSaving(true);
    try {
      await onCreate(built.request);
      setDraft(NEW_TARGET);
    } catch (error) {
      setFailure(error); // the input stays, so the user can fix it and try again
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby={`${uid}-heading`} className="grid gap-3 rounded-card border border-line bg-surface p-4">
      <h4 id={`${uid}-heading`} className="mb-0">
        New production target
      </h4>
      <p className="mb-0 text-sm text-muted">Alert when an item's production stays below a target.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField id={id("item")} label="Item" error={errors.item}>
          <select {...fieldAttrs(id("item"), undefined, errors.item)} value={draft.item} onChange={(e) => set("item", e.target.value)}>
            <option value="">Choose an item…</option>
            {items.map((i) => (
              <option key={i.className} value={i.className}>
                {i.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id={id("targetPerMinute")} label={`Target (${unitLabel(unit)})`} hint={FIELD_HINT.targetPerMinute} error={errors.targetPerMinute}>
          <input
            {...fieldAttrs(id("targetPerMinute"), FIELD_HINT.targetPerMinute, errors.targetPerMinute)}
            inputMode="decimal"
            value={draft.targetPerMinute}
            onChange={(e) => set("targetPerMinute", e.target.value)}
          />
        </FormField>
        <FormField id={id("windowMinutes")} label="Averaged over (min)" hint={FIELD_HINT.windowMinutes} error={errors.windowMinutes}>
          <input
            {...fieldAttrs(id("windowMinutes"), FIELD_HINT.windowMinutes, errors.windowMinutes)}
            inputMode="decimal"
            value={draft.windowMinutes}
            onChange={(e) => set("windowMinutes", e.target.value)}
          />
        </FormField>
        <FormField id={id("severity")} label="Severity" error={errors.severity}>
          <select {...fieldAttrs(id("severity"), undefined, errors.severity)} value={draft.severity} onChange={(e) => set("severity", e.target.value)}>
            {KNOWN_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {severityLabel(s)}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      {failure !== null && <ErrorNotice error={failure} />}
      <div>
        <button type="submit" disabled={saving}>
          {saving ? "Creating…" : "Create rule"}
        </button>
      </div>
    </form>
  );
}
