import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AlertRule } from "@satisfactory-dash/shared";
import { alertRulesEmpty, alertRulesList } from "@satisfactory-dash/shared/fixtures";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/errors";
import type { EditorItem } from "./ruleDraft";
import { RulesEditor } from "./RulesEditor";

const rules = alertRulesList.rules as AlertRule[];
const items: EditorItem[] = [
  { className: "Desc_Wire_C", name: "Wire", unit: "items/min" },
  { className: "Desc_IronPlate_C", name: "Iron Plate", unit: "items/min" },
  { className: "Desc_LiquidFuel_C", name: "Fuel", unit: "m3/min" },
];

function setup(overrides: Partial<Parameters<typeof RulesEditor>[0]> = {}) {
  const props = {
    rules,
    items,
    canEdit: true,
    onCreate: vi.fn(() => Promise.resolve()),
    onUpdate: vi.fn(() => Promise.resolve()),
    onDelete: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  return { ...render(<RulesEditor {...props} />), props };
}

const card = (name: RegExp | string) => screen.getByRole("article", { name });

describe("RulesEditor", () => {
  it("shows a card per rule, named by kind, the production rule with its item", () => {
    setup();
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-labelledby") && within(a).getByRole("heading").textContent)).toEqual([
      "Power outage",
      "Stopped machines",
      "Game server unreachable",
      "Production below target · Iron Plate",
    ]);
  });

  it("marks presets, which can't be deleted, and offers Delete only on the others", () => {
    setup();
    const outage = card("Power outage");
    expect(within(outage).getByText("Preset: can be turned off, not deleted.")).toBeInTheDocument();
    expect(within(outage).queryByRole("button", { name: "Delete rule" })).not.toBeInTheDocument();
    expect(within(card(/Production below target/)).getByRole("button", { name: "Delete rule" })).toBeInTheDocument();
  });

  it("edits every duration in minutes, with the edge-triggered hint for power outage", () => {
    setup();
    const outage = card("Power outage");
    expect(within(outage).getByRole("textbox", { name: "Fire after (min)" })).toHaveValue("0");
    expect(within(outage).getByRole("textbox", { name: "Fire after (min)" })).toHaveAccessibleDescription("0 = at once.");
    expect(within(card("Game server unreachable")).getByRole("textbox", { name: "For at least (min)" })).toHaveValue("2");
  });

  it("disables Save until something changes, then sends only the change", async () => {
    const { props } = setup();
    const stopped = card("Stopped machines");
    const save = within(stopped).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(within(stopped).getByRole("textbox", { name: "Stopped below (%)" }), { target: { value: "8" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(rules[1].id, { params: { stoppedBelowPercent: 8 } }));
  });

  it("shows a field's error, tied to it, and sends nothing", () => {
    const { props } = setup();
    const stopped = card("Stopped machines");
    const repeat = within(stopped).getByRole("textbox", { name: "Repeat every (min)" });
    fireEvent.change(repeat, { target: { value: "0.5" } });
    fireEvent.click(within(stopped).getByRole("button", { name: "Save" }));
    expect(repeat).toHaveAttribute("aria-invalid", "true");
    // Said once: the error replaces the hint rather than repeating it.
    expect(repeat).toHaveAccessibleDescription("From 1 to 10,080 minutes (7 days).");
    expect(within(stopped).getAllByText("From 1 to 10,080 minutes (7 days).")).toHaveLength(1);
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("keeps the input and shows the error when a save fails, and disables Save while saving", async () => {
    let reject!: (e: unknown) => void;
    const onUpdate = vi.fn(() => new Promise((_, r) => (reject = r)));
    setup({ onUpdate });
    const stopped = card("Stopped machines");
    const box = within(stopped).getByRole("textbox", { name: "Stopped below (%)" });
    fireEvent.change(box, { target: { value: "8" } });
    fireEvent.click(within(stopped).getByRole("button", { name: "Save" }));
    expect(await within(stopped).findByRole("button", { name: "Saving…" })).toBeDisabled();
    reject(new ApiError(403, { code: "forbidden", message: "You can't change this server's alerts.", requestId: "req-1" }));
    expect(await within(stopped).findByText(/You can't change this server's alerts\./)).toBeInTheDocument();
    expect(box).toHaveValue("8");
    expect(within(stopped).getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("resets a card from the saved rule the parent passes back", () => {
    const { rerender, props } = setup();
    fireEvent.click(within(card("Stopped machines")).getByRole("checkbox", { name: "Enabled" }));
    const saved = rules.map((r) => (r.id === rules[1].id ? { ...r, enabled: false, updatedAt: "2026-09-26T12:05:00.000Z" } : r));
    rerender(<RulesEditor {...props} rules={saved} />);
    const stopped = card("Stopped machines");
    expect(within(stopped).getByRole("checkbox", { name: "Enabled" })).not.toBeChecked();
    expect(within(stopped).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows the production rule's item read-only, with its unit on the target", () => {
    setup({ items: [{ className: "Desc_IronPlate_C", name: "Iron Plate", unit: "items/min" }] });
    const production = card(/Production below target/);
    expect(within(production).getByText("To watch another item, delete this rule and create a new one.")).toBeInTheDocument();
    expect(within(production).queryByRole("combobox", { name: "Item" })).not.toBeInTheDocument();
    expect(within(production).getByRole("textbox", { name: "Target (items/min)" })).toHaveValue("120");
  });

  it("keeps a rule whose item isn't in today's factory, under its class name made readable", () => {
    setup({ items: [] });
    expect(within(card(/Production below target/)).getByRole("heading").textContent).toBe("Production below target · Iron Plate");
    expect(within(card(/Production below target/)).getByRole("textbox", { name: "Target (per min)" })).toBeInTheDocument();
  });

  it("confirms a delete in the card, then calls onDelete", async () => {
    const { props } = setup();
    const production = card(/Production below target/);
    fireEvent.click(within(production).getByRole("button", { name: "Delete rule" }));
    const confirm = within(production).getByRole("group", { name: "Confirm delete" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(production).getByRole("button", { name: "Delete rule" }));
    fireEvent.click(within(production).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith(rules[3].id));
  });

  it("handles an unknown kind with the common fields only, and an unknown severity as it is", async () => {
    const odd: AlertRule = { ...rules[0], id: "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5eaa", kind: "belt_jam", severity: "page-me", params: { belts: 2 }, preset: false };
    const { props } = setup({ rules: [odd] });
    const article = card("Belt jam");
    expect(within(article).getByRole("combobox", { name: "Severity" })).toHaveValue("page-me");
    expect(within(article).getAllByRole("textbox").map((t) => t.getAttribute("id") && t.closest("div")?.querySelector("label")?.textContent)).toEqual([
      "Fire after (min)",
      "Clear after (min)",
      "Repeat every (min)",
    ]);
    fireEvent.click(within(article).getByRole("checkbox", { name: "Enabled" }));
    fireEvent.click(within(article).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(odd.id, { enabled: false }));
  });

  it("says when there are no rules", () => {
    setup({ rules: alertRulesEmpty.rules });
    expect(screen.getByText("No alert rules yet.")).toBeInTheDocument();
  });

  it("does not call onUpdate twice for a rapid double-click on Save (disabled synchronously)", async () => {
    let resolve!: () => void;
    const onUpdate = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    setup({ onUpdate });
    const stopped = card("Stopped machines");
    fireEvent.change(within(stopped).getByRole("textbox", { name: "Stopped below (%)" }), { target: { value: "8" } });
    const save = within(stopped).getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(within(stopped).getByRole("button", { name: "Saving…" })); // already disabled; a native no-op
    resolve();
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
  });

  it("does not call onDelete twice for a rapid double-click on Delete (disabled synchronously)", async () => {
    let resolve!: () => void;
    const onDelete = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    setup({ onDelete });
    const production = card(/Production below target/);
    fireEvent.click(within(production).getByRole("button", { name: "Delete rule" }));
    const confirm = within(production).getByRole("group", { name: "Confirm delete" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(production).getByRole("button", { name: "Deleting…" })); // already disabled
    resolve();
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });

  it("does not throw when onUpdate resolves after the card has unmounted", async () => {
    let resolve!: () => void;
    const onUpdate = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const { unmount } = setup({ onUpdate });
    const stopped = card("Stopped machines");
    fireEvent.change(within(stopped).getByRole("textbox", { name: "Stopped below (%)" }), { target: { value: "8" } });
    fireEvent.click(within(stopped).getByRole("button", { name: "Save" }));
    unmount();
    expect(() => resolve()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("clears aria-invalid and the error description once the field is fixed and resubmitted", async () => {
    const { props } = setup();
    const stopped = card("Stopped machines");
    const repeat = within(stopped).getByRole("textbox", { name: "Repeat every (min)" });
    fireEvent.change(repeat, { target: { value: "0.5" } });
    fireEvent.click(within(stopped).getByRole("button", { name: "Save" }));
    expect(repeat).toHaveAttribute("aria-invalid", "true");
    expect(repeat.getAttribute("aria-describedby")).toMatch(/-error$/);

    fireEvent.change(repeat, { target: { value: "5" } });
    fireEvent.click(within(stopped).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(rules[1].id, { repeatSeconds: 300 }));
    expect(repeat).not.toHaveAttribute("aria-invalid");
    expect(repeat.getAttribute("aria-describedby")).toMatch(/-hint$/);
  });

  it("keeps Save disabled after retyping the same value in different notation (found by the test-hunter)", () => {
    const { props } = setup();
    const stopped = card("Stopped machines");
    const box = within(stopped).getByRole("textbox", { name: "Stopped below (%)" });
    // Same numeric value as the stored 5, just reformatted - a plausible "type away, then back" edit.
    fireEvent.change(box, { target: { value: "5.0" } });
    const save = within(stopped).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(props.onUpdate).not.toHaveBeenCalled();
    // A real change still enables it.
    fireEvent.change(box, { target: { value: "5.5" } });
    expect(save).toBeEnabled();
  });

  it("renders a production rule whose stored params fail its own schema without crashing, and hides its item fields", () => {
    const badTarget: AlertRule = { ...rules[3], params: { item: "Desc_IronPlate_C", targetPerMinute: -5, windowMinutes: 10 } };
    setup({ rules: [badTarget] });
    const production = card("Production below target");
    expect(within(production).queryByText("Iron Plate")).not.toBeInTheDocument();
    expect(within(production).queryByRole("textbox", { name: /Target/ })).not.toBeInTheDocument();
    expect(within(production).getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("New production target", () => {
  const form = () => screen.getByRole("form", { name: "New production target" });

  it("lists items by name and shows the chosen item's unit on the target", () => {
    setup();
    const item = within(form()).getByRole("combobox", { name: "Item" });
    expect(within(item).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose an item…", "Fuel", "Iron Plate", "Wire"]);
    fireEvent.change(item, { target: { value: "Desc_LiquidFuel_C" } });
    expect(within(form()).getByRole("textbox", { name: "Target (m³/min)" })).toBeInTheDocument();
  });

  it("creates with the item, target and window only, then resets", async () => {
    const { props } = setup();
    fireEvent.change(within(form()).getByRole("combobox", { name: "Item" }), { target: { value: "Desc_Wire_C" } });
    fireEvent.change(within(form()).getByRole("textbox", { name: "Target (items/min)" }), { target: { value: "90" } });
    fireEvent.click(within(form()).getByRole("button", { name: "Create rule" }));
    await waitFor(() =>
      expect(props.onCreate).toHaveBeenCalledWith({
        kind: "production_below_target",
        params: { item: "Desc_Wire_C", targetPerMinute: 90, windowMinutes: 10 },
      }),
    );
    await waitFor(() => expect(within(form()).getByRole("combobox", { name: "Item" })).toHaveValue(""));
  });

  it("says what's missing before sending anything", () => {
    const { props } = setup();
    fireEvent.click(within(form()).getByRole("button", { name: "Create rule" }));
    const itemSelect = within(form()).getByRole("combobox", { name: "Item" });
    expect(itemSelect).toHaveAttribute("aria-invalid", "true");
    // The select, like an invalid input, must point at its own error text (fieldAttrs.ts), not just look invalid.
    expect(itemSelect.getAttribute("aria-describedby")).toBe(`${itemSelect.id}-error`);
    expect(within(form()).getByText("Choose an item.", { selector: `#${itemSelect.id}-error` })).toBeInTheDocument();
    expect(within(form()).getByText("More than 0.", { selector: ".text-bad" })).toBeInTheDocument();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("keeps the input and shows the backend's refusal", async () => {
    const onCreate = vi.fn(() => Promise.reject(new ApiError(409, { code: "rule_kind_not_creatable", message: "That kind of rule can't be created.", requestId: "req-2" })));
    setup({ onCreate });
    fireEvent.change(within(form()).getByRole("combobox", { name: "Item" }), { target: { value: "Desc_Wire_C" } });
    fireEvent.change(within(form()).getByRole("textbox", { name: "Target (items/min)" }), { target: { value: "90" } });
    fireEvent.click(within(form()).getByRole("button", { name: "Create rule" }));
    expect(await within(form()).findByText(/That kind of rule can't be created\./)).toBeInTheDocument();
    expect(within(form()).getByRole("combobox", { name: "Item" })).toHaveValue("Desc_Wire_C");
  });
});

describe("read-only (a member)", () => {
  it("shows every setting as text, with the same labels, and no controls", () => {
    setup({ canEdit: false });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "New production target" })).not.toBeInTheDocument();
    expect(screen.getByText("Only a server owner or admin can change alert rules.")).toBeInTheDocument();
    const outage = card("Power outage");
    expect(within(outage).getByText("0 min (at once)")).toBeInTheDocument();
    expect(within(outage).getByText("Preset: can be turned off, not deleted.")).toBeInTheDocument();
    const production = card(/Production below target/);
    expect(within(production).getByText("120 items/min")).toBeInTheDocument();
    expect(within(production).getByText("To watch another item, delete this rule and create a new one.")).toBeInTheDocument();
    expect(within(card("Game server unreachable")).getByText("2 min")).toBeInTheDocument();
  });
});
