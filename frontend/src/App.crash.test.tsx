import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { renderWithClient } from "./test/render";

// Make one real view crash while rendering, as a bug in it would.
vi.mock("./power/PowerView", () => ({
  PowerView: () => {
    throw new Error("power view bug");
  },
}));

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("App with a crashing section", () => {
  it("contains the crash to that section; the rest of the dashboard and the footer stay", async () => {
    renderWithClient(<App />);
    expect(await screen.findByRole("alert", { name: "Power error" })).toHaveTextContent(
      "Power hit an error and couldn't be shown.",
    );
    // Other sections still render from the default (signed-in, one server) handlers.
    expect(await screen.findByRole("region", { name: "Server status" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Factory" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Satis Manager");
    expect(screen.getByRole("link", { name: "Source code (AGPL-3.0)" })).toBeInTheDocument();
  });
});
