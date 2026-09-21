import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ status: "ok" }),
      }),
    ) as unknown as typeof fetch,
  );
});

describe("App", () => {
  it("renders the backend status once the health check resolves", async () => {
    render(<App />);
    expect(await screen.findByText(/status: ok/i)).toBeInTheDocument();
  });
});
