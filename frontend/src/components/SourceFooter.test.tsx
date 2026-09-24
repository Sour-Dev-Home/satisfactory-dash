import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorUpstreamUnreachable, sessionAnonymous } from "@satisfactory-dash/shared/fixtures";
import App from "../App";
import { REPO_URL, sourceUrl } from "../source";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { SourceFooter } from "./SourceFooter";

const SHA = "0f6c73f2a9b1c4d5e6f708192a3b4c5d6e7f8091";
const link = () => screen.getByRole("link", { name: "Source code (AGPL-3.0)" });

describe("sourceUrl", () => {
  it("links to the exact commit when the build knows it", () => {
    expect(sourceUrl(SHA)).toBe(`${REPO_URL}/tree/${SHA}`);
    expect(sourceUrl("0f6c73f")).toBe(`${REPO_URL}/tree/0f6c73f`);
  });

  it("falls back to the repository root without a usable commit hash", () => {
    expect(sourceUrl("")).toBe(REPO_URL);
    expect(sourceUrl("main")).toBe(REPO_URL);
    expect(sourceUrl("0f6c73f/../evil")).toBe(REPO_URL);
    expect(sourceUrl("abc")).toBe(REPO_URL);
    // git and Cloudflare produce lowercase; GitHub's handling of uppercase isn't verified.
    expect(sourceUrl(SHA.toUpperCase())).toBe(REPO_URL);
  });
});

describe("SourceFooter", () => {
  it("renders the source link with a commit", () => {
    render(<SourceFooter commitSha={SHA} />);
    expect(link()).toHaveAttribute("href", `${REPO_URL}/tree/${SHA}`);
    expect(screen.getByRole("contentinfo")).toContainElement(link());
  });

  it("renders the source link without a commit (local dev, CI)", () => {
    render(<SourceFooter commitSha="" />);
    expect(link()).toHaveAttribute("href", REPO_URL);
  });

  it("uses the build's commit by default", () => {
    render(<SourceFooter />);
    // Empty locally and in CI; the Cloudflare build's commit if tests ever run there.
    expect(link()).toHaveAttribute("href", sourceUrl(__COMMIT_SHA__));
  });

  it("is on the login screen, for visitors who aren't signed in", async () => {
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAnonymous)));
    renderWithClient(<App />);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(link()).toBeInTheDocument();
  });

  it("stays reachable when the backend can't be reached", async () => {
    server.use(
      http.get(endpoints.auth.session.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })),
    );
    renderWithClient(<App />);
    await screen.findByRole("alert");
    expect(link()).toBeInTheDocument();
  });
});
