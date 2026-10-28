import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { FactoryResponse } from "@satisfactory-dash/shared";
import { factoryMixed } from "@satisfactory-dash/shared/fixtures";
import { FACTORY_ROW_CAP, FactoryPanel } from "./FactoryPanel";

/** `count` machines from one fixture machine, each with its own id and a padded name ("Machine 007"), every other one paused. */
function factoryOf(count: number): FactoryResponse {
  const base = factoryMixed.data.buildings[1];
  const buildings = Array.from({ length: count }, (_, i) => ({
    ...base,
    id: `${base.id}-${i + 1}`,
    name: `Machine ${String(i + 1).padStart(3, "0")}`,
    isPaused: i % 2 === 0,
  }));
  return { ...factoryMixed, data: { ...factoryMixed.data, buildings, backedUpCount: 0 } };
}

const names = () =>
  within(screen.getByRole("table"))
    .getAllByRole("rowheader")
    .map((th) => th.textContent);
const pick = (label: string) =>
  fireEvent.click(within(screen.getByRole("group", { name: "Filter machines" })).getByRole("button", { name: label }));
const search = (value: string) => fireEvent.change(screen.getByRole("searchbox", { name: "Search machines" }), { target: { value } });

describe("FactoryPanel row cap (ADR-0062 F.5)", () => {
  it("is 50", () => {
    expect(FACTORY_ROW_CAP).toBe(50);
  });

  it.each([49, 50])("shows all %i machines with no cap control", (count) => {
    render(<FactoryPanel snapshot={factoryOf(count)} />);
    expect(names()).toHaveLength(count);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show all/ })).not.toBeInTheDocument();
  });

  it("caps 51 machines at the first 50, says so, and offers the rest", () => {
    render(<FactoryPanel snapshot={factoryOf(51)} />);
    expect(names()).toHaveLength(50);
    expect(names().at(-1)).toBe("Machine 050");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 50 of 51 machines.");
    expect(screen.getByRole("button", { name: "Show all 51 machines" })).toBeInTheDocument();
    // The summary above still counts every machine.
    expect(screen.getByText(/^51 machines ·/)).toBeInTheDocument();
  });

  it("Show all reveals the rest in place and moves focus to the first newly shown machine", () => {
    render(<FactoryPanel snapshot={factoryOf(120)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 120 machines" }));
    expect(names()).toHaveLength(120);
    expect(names().slice(0, 50)).toEqual(Array.from({ length: 50 }, (_, i) => `Machine ${String(i + 1).padStart(3, "0")}`));
    const first = screen.getByRole("rowheader", { name: "Machine 051" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("status")).toHaveTextContent("Showing all 120 machines.");
  });

  it("Show fewer caps the list again and keeps focus on the control", () => {
    render(<FactoryPanel snapshot={factoryOf(120)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 120 machines" }));
    const fewer = screen.getByRole("button", { name: "Show only the first 50 machines" });
    fewer.focus();
    fireEvent.click(fewer);
    expect(names()).toHaveLength(50);
    const toggle = screen.getByRole("button", { name: "Show all 120 machines" });
    expect(toggle).toBe(fewer);
    expect(toggle).toHaveFocus();
    // No row is a leftover script-only focus target once capped.
    expect(within(screen.getByRole("table")).queryAllByRole("rowheader").filter((th) => th.hasAttribute("tabindex"))).toHaveLength(0);
  });

  it("caps again when the filter changes, and counts the filtered list", () => {
    render(<FactoryPanel snapshot={factoryOf(120)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 120 machines" }));
    pick("Paused");
    expect(names()).toHaveLength(50);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 50 of 60 machines.");
    pick("All");
    expect(names()).toHaveLength(50);
    expect(screen.getByRole("button", { name: "Show all 120 machines" })).toBeInTheDocument();
  });

  it("caps again when the search changes", () => {
    render(<FactoryPanel snapshot={factoryOf(120)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 120 machines" }));
    search("Machine");
    expect(names()).toHaveLength(50);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 50 of 120 machines.");
  });

  it("stays expanded across a new snapshot with the same filter (the 30 s poll)", () => {
    const { rerender } = render(<FactoryPanel snapshot={factoryOf(120)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 120 machines" }));
    rerender(<FactoryPanel snapshot={factoryOf(121)} />);
    expect(names()).toHaveLength(121);
    // Focus moved once, on the click; the poll moves nothing.
    expect(screen.getByRole("rowheader", { name: "Machine 051" })).toHaveFocus();
  });

  it("a list that shrinks under the cap while expanded drops the control, and moves no focus when it grows back", () => {
    const { rerender } = render(<FactoryPanel snapshot={factoryOf(120)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 120 machines" }));
    rerender(<FactoryPanel snapshot={factoryOf(40)} />);
    expect(names()).toHaveLength(40);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    rerender(<FactoryPanel snapshot={factoryOf(120)} />);
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("a poll that shrinks an expanded list but keeps it over the cap leaves the toggle and its count right", () => {
    const { rerender } = render(<FactoryPanel snapshot={factoryOf(120)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 120 machines" }));
    rerender(<FactoryPanel snapshot={factoryOf(70)} />);
    expect(names()).toHaveLength(70);
    expect(screen.getByRole("status")).toHaveTextContent("Showing all 70 machines.");
    expect(screen.getByRole("button", { name: "Show only the first 50 machines" })).toBeInTheDocument();
  });

  it("an empty filter result shows no cap control", () => {
    render(<FactoryPanel snapshot={factoryOf(120)} />);
    search("no such machine");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show all/ })).not.toBeInTheDocument();
  });

  it("a search reaches a machine past row 50, and the cap control goes once the list fits", () => {
    render(<FactoryPanel snapshot={factoryOf(120)} />);
    expect(screen.queryByRole("rowheader", { name: "Machine 117" })).not.toBeInTheDocument();
    search("Machine 117");
    expect(names()).toEqual(["Machine 117"]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a ?q= deep link (the view's search prop) reaches a machine past row 50", () => {
    function Linked() {
      const [q, setQ] = useState("machine 099");
      return <FactoryPanel snapshot={factoryOf(120)} search={q} onSearch={setQ} />;
    }
    render(<Linked />);
    expect(names()).toEqual(["Machine 099"]);
  });

  it("caps the filtered list, not the whole one: Paused over 50 still shows 50", () => {
    render(<FactoryPanel snapshot={factoryOf(120)} />);
    pick("Paused");
    expect(names()).toHaveLength(50);
    expect(names()[0]).toBe("Machine 001");
    expect(names().at(-1)).toBe("Machine 099");
  });
});
