import { droneRoutesSample, droneRoutesSampleWithPairedId } from "@satisfactory-dash/shared/fixtures";
import type { DronePort } from "@satisfactory-dash/shared";
import { describe, expect, it } from "vitest";
import { cargoText, dronePortKeys, dronePortName, pairedWithText, resolvePairings } from "./dronePorts";

const port = (over: Partial<DronePort> & Pick<DronePort, "id" | "name">): DronePort => ({
  paired: null,
  input: [],
  output: [],
  fuel: [],
  x: 0,
  y: 0,
  ...over,
});

describe("resolvePairings", () => {
  it("pairs the captured ports by name, one route for the two sides, the unpaired port alone", () => {
    const r = resolvePairings(droneRoutesSample.data);
    expect(r.partner).toEqual([1, 0, null]);
    expect(r.routes).toEqual([[0, 1]]);
    expect(r.unmatched).toBe(0);
  });

  it("pairs by pairedId when the sender gives it", () => {
    const r = resolvePairings(droneRoutesSampleWithPairedId.data);
    expect(r.partner).toEqual([1, 0, null]);
    expect(r.routes).toEqual([[0, 1]]);
    expect(r.unmatched).toBe(0);
  });

  it("prefers pairedId over a name that points elsewhere", () => {
    const ports = [
      port({ id: "a", name: "A", paired: "C", pairedId: "b" }),
      port({ id: "b", name: "B", paired: "A", pairedId: "a" }),
      port({ id: "c", name: "C" }),
    ];
    expect(resolvePairings(ports).partner).toEqual([1, 0, null]);
  });

  it("leaves a name that matches more than one port unmatched, and counts it", () => {
    const ports = [
      port({ id: "a", name: "Hub", paired: "Twin" }),
      port({ id: "b", name: "Twin", paired: "Hub" }),
      port({ id: "c", name: "Twin", paired: "Hub" }),
    ];
    const r = resolvePairings(ports);
    // "Twin" is two ports, so the hub's pairing is ambiguous; each twin names the one hub, so both draw a route.
    expect(r.partner).toEqual([null, 0, 0]);
    expect(r.routes).toEqual([[0, 1], [0, 2]]);
    expect(r.unmatched).toBe(1);
  });

  it("leaves a name or an id that matches no port unmatched", () => {
    const ports = [port({ id: "a", name: "A", paired: "Gone" }), port({ id: "b", name: "B", paired: "A", pairedId: "missing" })];
    const r = resolvePairings(ports);
    expect(r.partner).toEqual([null, null]);
    expect(r.routes).toEqual([]);
    expect(r.unmatched).toBe(2);
  });

  it("treats an explicit null pairedId on a paired port as the sender's unresolved pairing, not a name to look up", () => {
    const ports = [port({ id: "a", name: "A", paired: "B", pairedId: null }), port({ id: "b", name: "B" })];
    const r = resolvePairings(ports);
    expect(r.partner).toEqual([null, null]);
    expect(r.unmatched).toBe(1);
  });

  it("never pairs a port with itself", () => {
    const ports = [port({ id: "a", name: "Solo", paired: "Solo" }), port({ id: "b", name: "B", paired: null, pairedId: "b" })];
    const r = resolvePairings(ports);
    expect(r.partner).toEqual([null, null]);
    expect(r.routes).toEqual([]);
    expect(r.unmatched).toBe(2);
  });

  it("treats an id that repeats as ambiguous", () => {
    const ports = [port({ id: "a", name: "A", paired: "X", pairedId: "dup" }), port({ id: "dup", name: "X" }), port({ id: "dup", name: "Y" })];
    expect(resolvePairings(ports).partner[0]).toBeNull();
  });

  it("is safe with names that are Object.prototype keys", () => {
    const ports = [port({ id: "a", name: "A", paired: "constructor" }), port({ id: "__proto__", name: "toString", paired: "A" })];
    const r = resolvePairings(ports);
    expect(r.partner).toEqual([null, 0]);
    expect(r.unmatched).toBe(1);
  });

  it("draws one route for a one-sided pairing too", () => {
    const ports = [port({ id: "a", name: "A", paired: "B" }), port({ id: "b", name: "B" })];
    const r = resolvePairings(ports);
    expect(r.routes).toEqual([[0, 1]]);
    expect(r.partner).toEqual([1, null]);
  });
});

describe("drone port text", () => {
  it("names an unnamed port by its kind", () => {
    expect(dronePortName(port({ id: "a", name: "  " }))).toBe("Unnamed drone port");
    expect(dronePortName(port({ id: "a", name: "FUEL 5" }))).toBe("FUEL 5");
  });

  it("says who a port is paired with, or why not", () => {
    const ports = [port({ id: "a", name: "A", paired: "B" }), port({ id: "b", name: "B" }), port({ id: "c", name: "C", paired: "Gone" })];
    expect(pairedWithText(ports[0], ports[1])).toBe("B");
    expect(pairedWithText(ports[1], null)).toBe("Not paired");
    expect(pairedWithText(ports[2], null)).toBe("Gone (not matched to one port)");
    expect(pairedWithText(port({ id: "d", name: "D", pairedId: "x" }), null)).toBe("Unknown port (not matched to one port)");
  });

  it("lists the cargo by name, or says nothing is sent", () => {
    const name = (c: string) => (c === "Desc_Battery_C" ? "Battery" : c);
    expect(cargoText(["Desc_Battery_C", "Desc_Other_C"], name)).toBe("Battery, Desc_Other_C");
    expect(cargoText([], name)).toBe("Nothing");
  });

  it("keys ports by id and place, unique even when both repeat", () => {
    const ports = [port({ id: "a", name: "A" }), port({ id: "a", name: "A" }), port({ id: "a", name: "B", x: 1 })];
    const keys = dronePortKeys(ports);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe("a:0:0");
    expect(keys[2]).toBe("a:1:0");
  });
});
