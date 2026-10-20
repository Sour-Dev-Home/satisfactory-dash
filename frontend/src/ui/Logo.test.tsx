import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HazardStripe } from "./HazardStripe";
import { Logo } from "./Logo";

describe("Logo", () => {
  it("is the factory station beside the name, read as words, with the icon hidden", () => {
    render(
      <h1>
        <Logo />
      </h1>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Satis Manager" });
    const icon = heading.querySelector("svg")!;
    expect(icon).toHaveAttribute("data-station", "factory");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    // Capitals come from CSS, so the text (and what a screen reader says) stays "Satis Manager".
    expect(heading).toHaveTextContent(/^Satis Manager$/);
    expect(heading.firstElementChild).toHaveClass("font-display", "uppercase");
  });

  it("has a larger hero size", () => {
    const { container } = render(<Logo size="hero" />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "64");
  });
});

describe("HazardStripe", () => {
  it("is decorative: hidden from assistive tech, amber from the token class", () => {
    const { container } = render(<HazardStripe />);
    const stripe = container.querySelector("[data-hazard-stripe]")!;
    expect(stripe).toHaveAttribute("aria-hidden", "true");
    expect(stripe.querySelector("pattern rect")).toHaveClass("fill-accent");
    const fill = stripe.querySelector(":scope > rect")!.getAttribute("fill");
    expect(fill).toBe(`url(#${stripe.querySelector("pattern")!.id})`);
  });
});
