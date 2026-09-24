import { factoryMixed } from "@satisfactory-dash/shared/fixtures";
import type { FactoryBuilding } from "@satisfactory-dash/shared";
import { describe, expect, it } from "vitest";
import { buildingsLayer } from "./buildingsLayer";
import type { MapContext } from "./layers";

/** A fake Leaflet: records each marker's position, style and tooltip, and what was removed. */
function fakeContext() {
  const markers: { at: unknown; options: Record<string, unknown>; tooltip: () => HTMLElement }[] = [];
  const group = { removed: false, addTo: () => group, remove: () => (group.removed = true) };
  const L = {
    layerGroup: () => group,
    circleMarker: (at: unknown, options: Record<string, unknown>) => {
      const marker = {
        bindTooltip: (tooltip: () => HTMLElement) => {
          markers.push({ at, options, tooltip });
          return marker;
        },
        addTo: () => marker,
      };
      return marker;
    },
  };
  const ctx = {
    L,
    map: {},
    renderer: {},
    project: (x: number, y: number) => [-y, x],
    color: (token: string) => `color(${token})`,
  } as unknown as MapContext;
  return { ctx, markers, group };
}

describe("buildingsLayer.draw", () => {
  it("puts one marker per placed building, projected, coloured by state, ringed when backed up", () => {
    const { ctx, markers } = fakeContext();
    buildingsLayer.draw(ctx, factoryMixed.data);
    const buildings = factoryMixed.data.buildings;
    expect(markers).toHaveLength(buildings.length);
    const backedUp = buildings.findIndex((b) => b.isBackedUp);
    expect(markers[backedUp].at).toEqual([-buildings[backedUp].location!.yM, buildings[backedUp].location!.xM]);
    expect(markers[backedUp].options.color).toBe("color(--color-warn)");
    const plain = buildings.findIndex((b) => !b.isBackedUp);
    expect(markers[plain].options.color).toBe(markers[plain].options.fillColor);
  });

  it("returns a cleanup that removes everything it drew", () => {
    const { ctx, group } = fakeContext();
    buildingsLayer.draw(ctx, factoryMixed.data)();
    expect(group.removed).toBe(true);
  });

  it("builds tooltips from text nodes: a building name is never parsed as HTML", () => {
    const { ctx, markers } = fakeContext();
    const hostile: FactoryBuilding = {
      ...factoryMixed.data.buildings[0],
      name: '<img src=x onerror="alert(1)">',
      recipe: "<b>Plate</b>",
    };
    buildingsLayer.draw(ctx, { buildings: [hostile], backedUpCount: 0 });
    const tip = markers[0].tooltip();
    expect(tip.querySelector("img, b")).toBeNull();
    expect(tip.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(tip.textContent).toContain("<b>Plate</b>");
  });
});
