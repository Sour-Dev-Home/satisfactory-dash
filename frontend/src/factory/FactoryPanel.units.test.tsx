import { fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, expectTypeOf, it } from "vitest";
import { endpoints, type FactoryResponse, type ProductionRate } from "@satisfactory-dash/shared";
import { factoryMixed, factoryOldBackend, factoryUnknownItem } from "@satisfactory-dash/shared/fixtures";
import { apiGet } from "../api/client";
import { ContractDriftError } from "../api/errors";
import type { RateUnit } from "../format";
import { server } from "../test/server";
import { FactoryPanel } from "./FactoryPanel";

// Fresh-eyes pass over ADR-0015 rate units: exact rendered text, the schema gate in front of
// the UI, and that every rate label on screen carries the backend's unit.

function outputs(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the request to fail");
}

/** factoryMixed with the refinery's first output's unit replaced by a raw (off-contract) value. */
function withRawUnit(unit: unknown): Record<string, unknown> {
  const body = structuredClone(factoryMixed) as unknown as {
    data: { buildings: { production: Record<string, unknown>[] }[] };
  };
  const refinery = body.data.buildings.find((b) => b.production.length === 2);
  if (!refinery) throw new Error("fixture changed: no two-output building");
  refinery.production[0].unit = unit;
  return body as unknown as Record<string, unknown>;
}

describe("FactoryPanel rate units (exact text)", () => {
  it("renders the refinery's mixed units with single spaces and nothing hidden", () => {
    render(<FactoryPanel snapshot={factoryMixed} />);
    const texts = outputs();
    // Exact textContent (toHaveTextContent collapses whitespace, this does not).
    expect(texts).toContain("Fuel: 40 / 40 m³/min (100%)");
    expect(texts).toContain("Polymer Resin: 30 / 30 items/min (100%)");
  });

  it("gives every output of a current backend a unit, never 'per min' or a raw 'm3'", () => {
    render(<FactoryPanel snapshot={factoryMixed} />);
    const texts = outputs();
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text).toMatch(/^.+: [\d.,]+ \/ [\d.,]+ (items\/min|m³\/min) \([\d.,]+%\)$/);
      expect(text).not.toMatch(/per min|m3/);
    }
  });

  it("keeps 'current / max unit' in one unbreakable group, so a phone only wraps before the '(%)' (#59)", () => {
    render(<FactoryPanel snapshot={factoryMixed} />);
    const groups = within(screen.getByRole("table"))
      .getAllByRole("listitem")
      .map((li) => li.querySelector(".whitespace-nowrap")?.textContent);
    expect(groups).toContain("40 / 40 m³/min");
    expect(groups).toContain("30 / 30 items/min");
    expect(groups).not.toContain(undefined);
  });

  it("keeps the name prefix and percent suffix out of the nowrap span (#59)", () => {
    render(<FactoryPanel snapshot={factoryMixed} />);
    const spans = within(screen.getByRole("table"))
      .getAllByRole("listitem")
      .map((li) => li.querySelector(".whitespace-nowrap")?.textContent ?? "");
    for (const text of spans) {
      // The span should hold exactly "current / max unit" -- neither the leading
      // "Name: " nor the trailing " (pct%)" should have leaked inside it.
      expect(text).not.toMatch(/:/);
      expect(text).not.toMatch(/[()%]/);
    }
  });

  it("wraps the unknown-unit fallback ('per min') in the nowrap span too (#59)", () => {
    render(<FactoryPanel snapshot={factoryUnknownItem} />);
    const li = within(screen.getByRole("table")).getByRole("listitem");
    expect(li.querySelector(".whitespace-nowrap")?.textContent).toBe("10 / 10 per min");
  });

  it("wraps the absent-unit (older-backend) fallback in the nowrap span too (#59)", () => {
    render(<FactoryPanel snapshot={factoryOldBackend} />);
    const li = within(screen.getByRole("table")).getByRole("listitem");
    expect(li.querySelector(".whitespace-nowrap")?.textContent).toBe("20 / 20 per min");
  });

  it("renders the unknown-unit fallback exactly (null unit)", () => {
    render(<FactoryPanel snapshot={factoryUnknownItem} />);
    expect(outputs()).toEqual(["Modded Widget: 10 / 10 per min (100%)"]);
  });

  it("renders the older-backend fallback exactly (unit absent)", () => {
    render(<FactoryPanel snapshot={factoryOldBackend} />);
    expect(outputs()).toEqual(["Iron Plate: 20 / 20 per min (100%)"]);
  });

  it("keeps a zero-rate fluid output in its unit", () => {
    const refinery = factoryMixed.data.buildings.find((b) => b.production.length === 2);
    if (!refinery) throw new Error("fixture changed: no two-output building");
    const idle = {
      ...factoryMixed,
      data: {
        ...factoryMixed.data,
        buildings: [
          {
            ...refinery,
            production: [{ ...refinery.production[0], currentPerMinute: 0, percent: 0 }],
          },
        ],
      },
    } satisfies FactoryResponse;
    render(<FactoryPanel snapshot={idle} />);
    expect(outputs()).toEqual(["Fuel: 0 / 40 m³/min (0%)"]);

    // The nowrap group must hold "0 / 40 m³/min" -- a 0% row shouldn't drop the span or
    // its content just because the current rate is zero.
    const li = within(screen.getByRole("table")).getByRole("listitem");
    expect(li.querySelector(".whitespace-nowrap")?.textContent).toBe("0 / 40 m³/min");
  });
});

describe("FactoryPanel rate units with search", () => {
  it("still finds the refinery by recipe, with both units intact", () => {
    render(<FactoryPanel snapshot={factoryMixed} />);
    fireEvent.change(screen.getByRole("searchbox", { name: /search machines/i }), { target: { value: "fuel" } });
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(outputs()).toEqual(["Fuel: 40 / 40 m³/min (100%)", "Polymer Resin: 30 / 30 items/min (100%)"]);
  });

  it("does not match machines by the unit text", () => {
    render(<FactoryPanel snapshot={factoryMixed} />);
    fireEvent.change(screen.getByRole("searchbox", { name: /search machines/i }), { target: { value: "m³/min" } });
    expect(screen.getByText("No machines match.")).toBeInTheDocument();
  });
});

describe("formatRate's RateUnit vs the contract", () => {
  it("matches ProductionRate.unit exactly, so a new contract unit can't silently fall back", () => {
    // RateUnit is derived from the contract; this pins that, and UNIT_LABEL's Record type then
    // forces a label for any unit the contract adds. Checked by `npm run typecheck`.
    expectTypeOf<NonNullable<ProductionRate["unit"]>>().toEqualTypeOf<RateUnit>();
  });
});

describe("factory response schema gate for unit", () => {
  const route = endpoints.factory.route;

  it.each([["m³/min"], ["M3/MIN"], ["liters/min"], [""], [0]])(
    "rejects an off-contract unit %j as contract drift before it reaches the UI",
    async (unit) => {
      server.use(http.get(route, () => HttpResponse.json(withRawUnit(unit))));
      const error = await caught(apiGet(endpoints.factory, "default"));
      expect(error).toBeInstanceOf(ContractDriftError);
    },
  );

  it("accepts the same body with an on-contract unit (control for the rejections above)", async () => {
    server.use(http.get(route, () => HttpResponse.json(withRawUnit("items/min"))));
    const body = await apiGet(endpoints.factory, "default");
    expect(body.data.buildings.some((b) => b.production.some((p) => p.name === "Fuel" && p.unit === "items/min"))).toBe(
      true,
    );
  });

  it("accepts a null unit and an absent unit (ADR-0007 additive field)", async () => {
    server.use(http.get(route, () => HttpResponse.json(factoryUnknownItem)));
    const unknown = await apiGet(endpoints.factory, "default");
    expect(unknown.data.buildings[0].production[0].unit).toBeNull();

    server.use(http.get(route, () => HttpResponse.json(factoryOldBackend)));
    const old = await apiGet(endpoints.factory, "default");
    expect(old.data.buildings[0].production[0]).not.toHaveProperty("unit");
  });
});
