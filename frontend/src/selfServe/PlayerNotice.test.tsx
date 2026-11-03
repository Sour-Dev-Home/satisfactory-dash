import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYER_NOTICE, PlayerNotice } from "./PlayerNotice";

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

describe("PlayerNotice", () => {
  it("shows the lead, the message, and says the mod sends counts only", () => {
    render(<PlayerNotice />);
    expect(screen.getByRole("heading", { name: "Tell your players" })).toBeInTheDocument();
    expect(screen.getByText(/the members of this server can see who is online/)).toBeInTheDocument();
    expect(screen.getByText(/The mod sends player counts only/)).toBeInTheDocument();
    expect(screen.getByText(PLAYER_NOTICE)).toBeInTheDocument();
  });

  it("names the product by its one name, Satis Manager (owner, 2026-11-03)", () => {
    expect(PLAYER_NOTICE).toMatch(/^This server is connected to Satis Manager, /);
    expect(PLAYER_NOTICE).not.toMatch(/Satisfactory Dash/);
  });

  it("says the names are live and not stored", () => {
    render(<PlayerNotice />);
    expect(screen.getByText(/Names are shown live and are not stored\./)).toBeInTheDocument();
  });

  it("copies exactly the message", async () => {
    render(<PlayerNotice />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy the message for your players" }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(PLAYER_NOTICE);
  });
});
