// TEMPORARY review harness (never committed): renders RulesEditor from the fixtures.
import "../../index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { AlertRule } from "@satisfactory-dash/shared";
import { alertRulesList } from "@satisfactory-dash/shared/fixtures";
import { RulesEditor } from "./RulesEditor";
import type { EditorItem } from "./ruleDraft";

const rules = alertRulesList.rules as AlertRule[];
const items: EditorItem[] = [
  { className: "Desc_IronPlate_C", name: "Iron Plate", unit: "items/min" },
  { className: "Desc_LiquidFuel_C", name: "Fuel", unit: "m3/min" },
];
const later = () => new Promise((resolve) => setTimeout(resolve, 800));
const canEdit = new URLSearchParams(location.search).get("canEdit") !== "false";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="mx-auto grid max-w-5xl gap-4 p-4">
      <h2>Alert rules ({canEdit ? "owner/admin" : "member, read-only"})</h2>
      <RulesEditor rules={rules} items={items} canEdit={canEdit} onCreate={later} onUpdate={later} onDelete={later} />
    </main>
  </StrictMode>,
);
