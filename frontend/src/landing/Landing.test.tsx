import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { REPO_URL } from "../source";
import { DEMO_URL, Landing, VIDEO_URL } from "./Landing";

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

describe("Landing", () => {
  it("leads with what it is, the live demo, and an invite-only sign-in", () => {
    renderLanding();
    expect(screen.getByRole("heading", { level: 2, name: /A live dashboard for your Satisfactory dedicated server/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try the live demo" })).toHaveAttribute("href", DEMO_URL);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/app");
    expect(screen.getByText(/invite-only during the beta/)).toBeInTheDocument();
  });

  it("embeds the walkthrough self-hosted, click to play, with its poster", () => {
    const { container } = renderLanding();
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", VIDEO_URL);
    expect(VIDEO_URL.startsWith("/")).toBe(true); // our own origin, never a video platform
    expect(video).toHaveAttribute("poster", "/og-image.png");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "none");
    expect(video).not.toHaveAttribute("autoplay");
  });

  it("gives the silent video a text alternative, linked to it", () => {
    const { container } = renderLanding();
    const video = container.querySelector("video")!;
    const transcript = container.querySelector<HTMLElement>(`#${video.getAttribute("aria-describedby")}`)!;
    expect(transcript).not.toBeNull();
    expect(within(transcript).getAllByRole("listitem", { hidden: true }).length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText("What the video shows")).toBeInTheDocument();
  });

  it("claims only the features that ship: power, factory health, auto-pause", () => {
    renderLanding();
    const features = within(screen.getByRole("region", { name: "What it shows" })).getAllByRole("heading", { level: 3 });
    expect(features.map((heading) => heading.textContent)).toEqual(["Power", "Factory health", "Auto-pause"]);
  });

  it("links the source and the architecture docs, and says it's unofficial", () => {
    renderLanding();
    const built = within(screen.getByRole("region", { name: "How it's built" }));
    expect(built.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute("href", REPO_URL);
    expect(built.getByRole("link", { name: "Architecture decisions" }).getAttribute("href")).toMatch(/^https:\/\/github\.com\//);
    expect(built.getByRole("link", { name: "Architecture diagrams" }).getAttribute("href")).toMatch(/^https:\/\/github\.com\//);
    expect(screen.getByText(/Not affiliated with Coffee Stain Studios/)).toBeInTheDocument();
  });
});
