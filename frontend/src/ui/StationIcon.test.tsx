import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StationIcon, type StationKind } from "./StationIcon";
import { MACHINE_HOUSING, MACHINE_WINDOW } from "./stationShapes";

const KINDS: StationKind[] = ["server", "power", "factory", "machine"];

describe("StationIcon", () => {
  it.each(KINDS)("draws the %s station, hidden from screen readers by default", (kind) => {
    const { container } = render(<StationIcon kind={kind} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("data-station", kind);
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(svg.childElementCount).toBeGreaterThan(0);
  });

  it("draws the machine from the shapes the map's canvas uses (stationShapes.ts)", () => {
    const { container } = render(<StationIcon kind="machine" />);
    const rects = [...container.querySelectorAll("rect")];
    for (const shape of [MACHINE_HOUSING, MACHINE_WINDOW]) {
      expect(
        rects.some(
          (r) =>
            r.getAttribute("x") === String(shape.x) &&
            r.getAttribute("y") === String(shape.y) &&
            r.getAttribute("width") === String(shape.width) &&
            r.getAttribute("height") === String(shape.height) &&
            r.getAttribute("rx") === String(shape.rx),
        ),
      ).toBe(true);
    }
  });

  it("is a named image when given a title", () => {
    render(<StationIcon kind="factory" title="Factory" />);
    const img = screen.getByRole("img", { name: "Factory" });
    expect(img).not.toHaveAttribute("aria-hidden");
  });

  it("takes its size in pixels, 32 by default", () => {
    const { container, rerender } = render(<StationIcon kind="server" />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "32");
    rerender(<StationIcon kind="server" size={20} />);
    expect(container.querySelector("svg")).toHaveAttribute("height", "20");
  });

  it("colours only with token classes: no fill or stroke colour values, no style attribute (the CSP)", () => {
    for (const kind of KINDS) {
      const { container, unmount } = render(<StationIcon kind={kind} />);
      expect(container.querySelector("[style]")).toBeNull();
      for (const el of container.querySelectorAll("svg *")) {
        expect(el.getAttribute("fill")).toBeNull();
        expect(el.getAttribute("stroke")).toBeNull();
      }
      unmount();
    }
  });
});
