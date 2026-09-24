import { screen } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { sessionAnonymous } from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { REPO_URL, sourceUrl } from "../source";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";

const SHA40 = "0f6c73f2a9b1c4d5e6f708192a3b4c5d6e7f8091";
const link = () => screen.getByRole("link", { name: "Source code (AGPL-3.0)" });

describe("sourceUrl edge cases", () => {
  it("accepts both ends of the hash length range", () => {
    expect(sourceUrl(SHA40.slice(0, 7))).toBe(`${REPO_URL}/tree/${SHA40.slice(0, 7)}`);
    expect(sourceUrl(SHA40)).toBe(`${REPO_URL}/tree/${SHA40}`);
  });

  it.each([
    ["6 hex chars", SHA40.slice(0, 6)],
    ["41 hex chars", `${SHA40}a`],
    ["a SHA-256 length hash", "a".repeat(64)],
    ["a very long input", "a".repeat(100_000)],
    ["a trailing newline", `${SHA40}\n`],
    ["a leading newline", `\n${SHA40}`],
    ["surrounding spaces", ` ${SHA40} `],
    ["a 0x prefix", `0x${SHA40.slice(0, 20)}`],
    ["a non-hex letter", `${SHA40.slice(0, 39)}g`],
    ["full-width digits", "０１２３４５６７"],
    ["a query string", `${SHA40.slice(0, 7)}?x=1`],
    ["a fragment", `${SHA40.slice(0, 7)}#x`],
    ["a path traversal", "../../evil"],
    ["an absolute URL", "https://evil.example"],
  ])("falls back to the repository root for %s", (_label, value) => {
    expect(sourceUrl(value)).toBe(REPO_URL);
  });

  it("always yields an https URL under the project repository", () => {
    for (const value of ["", SHA40, "junk", "a".repeat(40)]) {
      const url = new URL(sourceUrl(value));
      expect(url.protocol).toBe("https:");
      expect(url.host).toBe("github.com");
      expect(url.pathname.startsWith("/Sour-Dev-Home/satisfactory-dash")).toBe(true);
    }
  });
});

describe("SourceFooter in the app", () => {
  it("is the only contentinfo landmark and sits outside <main>", async () => {
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)));
    renderWithClient(<App />);
    await screen.findByRole("heading", { name: "Sign in" });
    const footers = screen.getAllByRole("contentinfo");
    expect(footers).toHaveLength(1);
    expect(footers[0]).toContainElement(link());
    expect(screen.getByRole("main")).not.toContainElement(link());
  });

  it("is present while the session is still loading", async () => {
    server.use(
      http.get(endpoints.auth.session.route, async () => {
        await delay("infinite");
        return HttpResponse.json(sessionAnonymous);
      }),
    );
    renderWithClient(<App />);
    await screen.findByText("Checking session…");
    expect(link()).toHaveAttribute("href", REPO_URL);
  });
});
