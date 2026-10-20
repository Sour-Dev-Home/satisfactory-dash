import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capacityShare, powerTotals } from "./power";
import { PowerCard } from "./PowerCard";

const grid = (consumptionMW: number, capacityMW: number, circuits = 1) => ({ consumptionMW, capacityMW, circuits });

const strip = () => screen.getByRole("region", { name: "Power" }).querySelector("svg[data-flowing]")!;

/** jsdom has no matchMedia: stand one in that answers the reduced-motion query. */
function preferReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PowerCard", () => {
  it("says consumption of capacity under the bar", () => {
    render(<PowerCard state={grid(4396, 6150)} />);
    expect(screen.getByRole("region", { name: "Power" })).toHaveTextContent("4,396 MW of 6,150 MW");
  });

  it("fills the capacity bar in amber to consumption over capacity", () => {
    const { container } = render(<PowerCard state={grid(4396, 6150)} />);
    const bar = container.querySelector("svg[data-share]")!;
    expect(Number(bar.getAttribute("data-share"))).toBeCloseTo(4396 / 6150);
    expect(bar.querySelector(".fill-accent")).toHaveAttribute("width", `${(4396 / 6150) * 100}%`);
  });

  it("flows the circuit strip while power is drawn", () => {
    render(<PowerCard state={grid(4396, 6150)} />);
    expect(strip()).toHaveAttribute("data-flowing", "true");
    expect(strip().querySelector(".circuit-flow")).not.toBeNull();
  });

  it("holds the strip still at 0 MW", () => {
    render(<PowerCard state={grid(0, 6150)} />);
    expect(strip()).toHaveAttribute("data-flowing", "false");
    expect(strip().querySelector(".circuit-flow")).toBeNull();
  });

  it("holds the strip still under reduced motion, even while power is drawn", () => {
    preferReducedMotion(true);
    render(<PowerCard state={grid(4396, 6150)} />);
    expect(strip()).toHaveAttribute("data-flowing", "false");
    expect(strip().querySelector(".circuit-flow")).toBeNull();
  });

  it("flows when the browser says motion is fine", () => {
    preferReducedMotion(false);
    render(<PowerCard state={grid(4396, 6150)} />);
    expect(strip()).toHaveAttribute("data-flowing", "true");
  });

  it("uses no style attributes (the CSP), so the animation can't shift layout through them", () => {
    const { container } = render(<PowerCard state={grid(4396, 6150)} />);
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("shows loading, failure and an empty grid as text, with no bar", () => {
    const { rerender, container } = render(<PowerCard state="pending" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    rerender(<PowerCard state="error" />);
    expect(screen.getByText("Couldn't load the power grid.")).toBeInTheDocument();
    rerender(<PowerCard state={grid(0, 0, 0)} />);
    expect(screen.getByText("No power circuits yet.")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("gives the card its corner rivets", () => {
    render(<PowerCard state="pending" />);
    expect(screen.getByRole("region", { name: "Power" }).querySelectorAll("[data-rivet]")).toHaveLength(4);
  });
});

describe("capacityShare", () => {
  it.each([
    [grid(4396, 6150), 4396 / 6150],
    [grid(450, 400), 1],
    [grid(0, 400), 0],
    [grid(100, 0), 0],
    [grid(-5, 400), 0],
    [grid(Number.NaN, 400), 0],
    [grid(100, Number.NaN), 0],
  ])("is between 0 and 1: %o gives %d", (totals, share) => {
    expect(capacityShare(totals)).toBeCloseTo(share);
  });
});

describe("powerTotals", () => {
  it("sums consumption and capacity across circuits and counts them", () => {
    expect(powerTotals([grid(100, 400), grid(250, 600)])).toEqual({ consumptionMW: 350, capacityMW: 1000, circuits: 2 });
  });

  it("is all zero for no circuits", () => {
    expect(powerTotals([])).toEqual({ consumptionMW: 0, capacityMW: 0, circuits: 0 });
  });
});
