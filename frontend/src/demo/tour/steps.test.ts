import { describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { designatedKeyOf } from "../../planner/factoryTree";
import { OPEN_PARAM } from "../../planner/PlannerView";
import { visibleTabs } from "../../shell/tabs";
import { withDemoDesignations } from "../designations";
import * as world from "../world";
import { TOUR_PLANNER_SEARCH, TOUR_STEPS } from "./steps";

// Every source file but tests, read as text: a step's target must be marked somewhere in the app (ADR-0065 Decision 5).
const sources = import.meta.glob<string>(["../../**/*.{ts,tsx}", "!../../**/*.test.{ts,tsx}", "!./**"], { query: "?raw", import: "default", eager: true });

/** About 15 seconds of reading (ADR-0065 owner's answer 5), at a slow 200 words a minute. */
const MAX_WORDS = 50;

describe("the tour's steps", () => {
  it("are the ADR's fifteen, each with its own id, a title and words short enough to read in 15 seconds", () => {
    expect(TOUR_STEPS).toHaveLength(15);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    for (const step of TOUR_STEPS) {
      expect(step.title.trim(), step.id).not.toBe("");
      expect(step.body.trim(), step.id).not.toBe("");
      expect(step.body.split(/\s+/).length, step.id).toBeLessThanOrEqual(MAX_WORDS);
    }
  });

  it("each go to a tab every visitor of the demo has", () => {
    const tabs = new Set(visibleTabs(false).map((t) => t.to));
    for (const step of TOUR_STEPS) expect(tabs, step.id).toContain(step.path);
  });

  it("each point at a target the app marks with tour(...), or none (the welcome only)", () => {
    const marked = (id: string) => Object.values(sources).some((text) => text.includes(`"${id}"`));
    expect(TOUR_STEPS.filter((s) => s.target === undefined).map((s) => s.id)).toEqual(["welcome"]);
    for (const step of TOUR_STEPS) {
      if (step.target !== undefined) expect(marked(step.target), `${step.id}: ${step.target}`).toBe(true);
      for (const opener of [step.openedBy ?? []].flat()) expect(marked(opener), `${step.id} opened by ${opener}`).toBe(true);
      if (step.keyTarget !== undefined) expect(marked(step.keyTarget), `${step.id} keyboard path`).toBe(true);
      if (step.done !== undefined) expect(marked("appears" in step.done ? step.done.appears : step.done.changes), `${step.id} done`).toBe(true);
    }
  });

  it("try-it steps (the planner's card, a map layer) say how they are done and ask for it in words", () => {
    const tries = TOUR_STEPS.filter((s) => s.kind === "try");
    expect(tries.map((s) => [s.id, s.done, s.doForMe])).toEqual([
      ["planner-group-card", { appears: "planner-group-panel" }, true],
      ["map-filters", { changes: "map-layer-toggle" }, true],
    ]);
    for (const step of tries) expect(step.body, step.id).toMatch(/Try it: /);
    // The details step after the card is the panel the card opens, so it shows at once once the card is clicked.
    const at = TOUR_STEPS.findIndex((s) => s.id === "planner-group-card");
    expect(TOUR_STEPS.at(at + 1)?.target).toBe("planner-group-panel");
  });

  it("open the planner on the demo's Plastic line, whose one group of machines is the oil refinery", () => {
    expect(TOUR_PLANNER_SEARCH).toBe(`?${new URLSearchParams([[OPEN_PARAM, designatedKeyOf(world.DEMO_DESIGNATION_ID)]])}`);
    const graph = ProductionGraphResponseSchema.parse(withDemoDesignations(world.productionGraph(world.DEMO_EPOCH))).data;
    const factory = graph.factories?.find((f) => f.key === designatedKeyOf(world.DEMO_DESIGNATION_ID));
    expect(factory?.name).toBe("Plastic line");
    const groups = graph.nodes.filter((n) => factory?.nodeKeys.includes(n.key) && n.kind === "machines");
    expect(groups.map((n) => [n.name, n.recipe])).toEqual([["Refinery", "Plastic"]]);
    for (const step of TOUR_STEPS.filter((s) => s.path === "/app/planner")) expect(step.search, step.id).toBe(TOUR_PLANNER_SEARCH);
  });
});
