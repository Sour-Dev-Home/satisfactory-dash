import type { ReactNode } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { renderWithClient } from "./test/render";

// AuthGate itself crashes on its first render(s), as a bug in it would; later renders work.
const gate = vi.hoisted(() => ({ broken: true }));
vi.mock("./auth/AuthGate", async (importOriginal) => {
  const real = await importOriginal<typeof import("./auth/AuthGate")>();
  return {
    AuthGate: ({ children }: { children: ReactNode }) => {
      if (gate.broken) throw new Error("auth gate bug");
      return <real.AuthGate>{children}</real.AuthGate>;
    },
  };
});

beforeEach(() => {
  gate.broken = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("App with a crash outside every section", () => {
  it("keeps the title and the source link, and Try again re-mounts the gates", async () => {
    renderWithClient(<App />);
    const alert = await screen.findByRole("alert", { name: "The dashboard error" });
    expect(alert).toHaveTextContent("The dashboard hit an error and couldn't be shown.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Satis Manager");
    expect(screen.getByRole("link", { name: "Source code (AGPL-3.0)" })).toBeInTheDocument();
    expect(alert).toContainElement(screen.getByRole("button", { name: "Sign out" }));

    gate.broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Server status" })).toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: "The dashboard error" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source code (AGPL-3.0)" })).toBeInTheDocument();
  });
});
