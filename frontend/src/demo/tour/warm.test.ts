import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { pageQueries } from "../../shell/pageQueries";
import { TOUR_STEPS, type TourStep } from "./steps";
import { TOUR_CHUNKS, warmTour } from "./warm";

const step = (id: string, path: string): TourStep => ({ id, path, title: id, body: id, kind: "next" });

describe("warming the tour's pages", () => {
  it("loads each distinct page's chunk and prefetches its primary queries, once per page", () => {
    const client = new QueryClient();
    const prefetch = vi.spyOn(client, "prefetchQuery").mockResolvedValue(undefined);
    const power = vi.fn(() => Promise.resolve());
    const map = vi.fn(() => Promise.resolve());
    const chunks = new Map([
      ["/app/power", power],
      ["/app/map", map],
    ]);
    const steps = [step("a", "/app"), step("b", "/app/power"), step("c", "/app/power"), step("d", "/app/map"), step("e", "/app")];
    warmTour(steps, { client, serverId: "s1", chunks });
    expect(power).toHaveBeenCalledTimes(1);
    expect(map).toHaveBeenCalledTimes(1);
    const want = ["/app", "/app/power", "/app/map"].flatMap((p) => pageQueries(p, "s1").map((q) => JSON.stringify(q.queryKey)));
    expect(prefetch.mock.calls.map(([options]) => JSON.stringify(options.queryKey))).toEqual(want);
  });

  it("starts no queries without a client or a server, and a failed chunk says nothing", async () => {
    const failing = vi.fn(() => Promise.reject(new Error("offline")));
    warmTour([step("b", "/app/power")], { client: undefined, serverId: undefined, chunks: new Map([["/app/power", failing]]) });
    expect(failing).toHaveBeenCalledTimes(1);
    await Promise.resolve(); // no unhandled rejection
  });

  it("has a chunk for each lazy page the tour visits: power's chart, the planner's graph, the map's canvas", () => {
    const paths = new Set(TOUR_STEPS.map((s) => s.path));
    for (const path of TOUR_CHUNKS.keys()) expect(paths.has(path)).toBe(true);
    expect([...TOUR_CHUNKS.keys()].sort()).toEqual(["/app/map", "/app/planner", "/app/power"]);
  });
});
