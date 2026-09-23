import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  statusNoGame,
  statusPaused,
  statusRunning,
  statusSlow,
  statusStale,
} from "@satisfactory-dash/shared/fixtures";
import { StatusPanel } from "./StatusPanel";

/** The <dd> that follows the <dt> with this label. */
function valueOf(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling as HTMLElement;
}

describe("StatusPanel", () => {
  it("shows the running server's values with ADR-0006 labels", () => {
    render(<StatusPanel snapshot={statusRunning} />);
    const panel = screen.getByRole("region", { name: "Server status" });
    expect(within(panel).getByText("Save", { selector: "dt" })).toBeInTheDocument();
    expect(valueOf("Save")).toHaveTextContent("ExampleSession");
    expect(valueOf("Players")).toHaveTextContent("0 / 4 connected");
    expect(valueOf("Server tick")).toHaveTextContent("Healthy (21.4 ticks/s)");
    expect(valueOf("Server tick")).not.toHaveClass("warning");
    expect(valueOf("Total play time on this save")).toHaveTextContent("1 d 2 h 50 m");
    expect(valueOf("As of")).toHaveTextContent(new Date(statusRunning.observedAt).toLocaleString());
    expect(screen.queryByText(/uptime/i)).not.toBeInTheDocument();
  });

  it("marks a slow tick as a warning", () => {
    render(<StatusPanel snapshot={statusSlow} />);
    expect(valueOf("Server tick")).toHaveTextContent("Slow (8.2 ticks/s)");
    expect(valueOf("Server tick")).toHaveClass("warning");
  });

  it("keeps showing a paused server's frozen values", () => {
    render(<StatusPanel snapshot={statusPaused} />);
    expect(valueOf("Save")).toHaveTextContent("ExampleSession");
    expect(valueOf("Total play time on this save")).toHaveTextContent("1 d 2 h 49 m");
  });

  it("keeps showing a stale snapshot's values and its own observedAt", () => {
    render(<StatusPanel snapshot={statusStale} />);
    expect(valueOf("As of")).toHaveTextContent(new Date(statusStale.observedAt).toLocaleString());
  });

  it("hides save-specific values when no save is loaded", () => {
    render(<StatusPanel snapshot={statusNoGame} />);
    expect(valueOf("Save")).toHaveTextContent("No save loaded");
    expect(screen.queryByText("Total play time on this save")).not.toBeInTheDocument();
  });
});
