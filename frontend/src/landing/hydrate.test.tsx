import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../api/queries";
import App from "../App";
import { renderLanding } from "./prerender";

// The prerendered landing page (site/plugin.ts) must hydrate without a mismatch: React reports one with console.error.
describe("landing page hydration", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hydrates the prerendered markup at / with no console error and keeps the text", async () => {
    window.history.pushState({}, "", "/");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    container.id = "root";
    document.body.append(container);
    // site/plugin.ts moves React's leading resource hints to <head>, so the root holds the rest.
    container.innerHTML = renderLanding().replace(/^(?:<link\b[^>]*>)+/, "");
    const before = container.querySelector("h2")?.textContent;
    expect(before).toBeTruthy();
    await act(async () => {
      hydrateRoot(
        container,
        <StrictMode>
          <QueryClientProvider client={createQueryClient()}>
            <App />
          </QueryClientProvider>
        </StrictMode>,
      );
    });
    expect(errors).not.toHaveBeenCalled();
    expect(container.querySelector("h2")?.textContent).toBe(before);
    expect(container.querySelector('a[href="/guides"]')).not.toBeNull();
    container.remove();
  });
});
