import { useMemo } from "react";
import type { AlertRule, CreateAlertRuleRequest, UpdateAlertRuleRequest } from "@satisfactory-dash/shared";
import type { ItemLabel } from "../../factory/itemLabels";
import { NewTargetForm } from "./NewTargetForm";
import { RuleCard } from "./RuleCard";
import type { EditorItem } from "./ruleDraft";

/**
 * The Alerts page's rules editor (ADR-0027 PR 9b), presentational: rules and items in, typed
 * requests out through Promise-returning callbacks; it never fetches. Owners and admins edit
 * (`canEdit`); members see the same settings as text. The page (9c) supplies the queries.
 */
export function RulesEditor({
  rules,
  items,
  canEdit,
  onCreate,
  onUpdate,
  onDelete,
}: {
  rules: AlertRule[];
  items: EditorItem[];
  canEdit: boolean;
  onCreate: (request: CreateAlertRuleRequest) => Promise<unknown>;
  onUpdate: (id: string, request: UpdateAlertRuleRequest) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const byClass = useMemo(() => new Map<string, ItemLabel>(items.map((i) => [i.className, { name: i.name, unit: i.unit }])), [items]);
  const sorted = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name)), [items]);
  return (
    <div className="grid gap-3">
      {!canEdit && <p className="mb-0 text-sm text-muted">Only a server owner or admin can change alert rules.</p>}
      {rules.length === 0 ? (
        <p>No alert rules yet.</p>
      ) : (
        rules.map((rule) => (
          // Keyed by updatedAt: once a save lands, the parent's fresh rule resets the card's draft.
          <RuleCard
            key={`${rule.id}-${rule.updatedAt}`}
            rule={rule}
            items={byClass}
            canEdit={canEdit}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        ))
      )}
      {canEdit && <NewTargetForm items={sorted} onCreate={onCreate} />}
    </div>
  );
}
