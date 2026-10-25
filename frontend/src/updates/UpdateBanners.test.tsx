import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { compatResponse, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { reporting } from "../test/updateMocks";
import { ServerUpdateLine, UpdateBanners } from "./UpdateBanners";

const summary = serversSingle.servers[0];

function reports(agentVersion: string | null, compat: unknown = compatResponse) {
  server.use(
    http.get(endpoints.agent.status.route, () => HttpResponse.json(agentVersion === null ? { ...reporting("0.1.0"), agentVersion: null } : reporting(agentVersion))),
    http.get(endpoints.compat.route, () => HttpResponse.json(compat as object)),
  );
}

function renderBanners() {
  return renderWithClient(
    <ServerContext value={summary}>
      <UpdateBanners />
    </ServerContext>,
  );
}

describe("UpdateBanners", () => {
  it("shows nothing for an up-to-date agent", async () => {
    reports("0.4.0");
    const { container } = renderBanners();
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when no version was reported, or the version is malformed", async () => {
    reports(null);
    const first = renderBanners();
    await new Promise((r) => setTimeout(r, 50));
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();
    reports("not-a-version");
    const second = renderBanners();
    await new Promise((r) => setTimeout(r, 50));
    expect(second.container).toBeEmptyDOMElement();
  });

  it("shows nothing when the policy cannot be read", async () => {
    server.use(
      http.get(endpoints.agent.status.route, () => HttpResponse.json(reporting("0.1.0"))),
      http.get(endpoints.compat.route, () => HttpResponse.json({ error: { code: "internal" } }, { status: 500 })),
    );
    const { container } = renderBanners();
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });

  it("says an agent update is available, restarts the agent only, and links the install steps", async () => {
    reports("0.3.5+ec24244.20261025");
    renderBanners();
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Update available: the game PC agent is 0.3.5+ec24244.20261025, the newest is 0.4.0.");
    expect(banner).toHaveTextContent("restart the agent only");
    const link = screen.getByRole("link", { name: "Install steps" });
    expect(link).toHaveAttribute("href", expect.stringContaining("docs-vault/wiki/runbooks/agent-app.md"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("says a mod update applies at the next server restart, with no install link of ours", async () => {
    reports("mod/1.1.5");
    renderBanners();
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("the Satisfactory Dash mod is 1.1.5, the newest is 1.2.0");
    expect(banner).toHaveTextContent("applies at the next server restart");
    expect(banner).toHaveTextContent("ficsit.app");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says an old version is unsupported and that features may be reduced", async () => {
    reports("0.1.5", { ...compatResponse, agent: { ...compatResponse.agent, minSafe: "0.1.0" } });
    renderBanners();
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Unsupported version: the game PC agent 0.1.5 is older than 0.2.0");
    expect(banner).toHaveTextContent("Some features may be reduced or missing");
    expect(banner).toHaveClass("banner-warning");
    // The unsupported notice already names the version to move to; no second "update available" beside it.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Dismiss/ })).not.toBeInTheDocument();
  });

  it("raises a security advisory with its summary, the fixed version and stronger styling", async () => {
    reports("mod/1.0.5");
    renderBanners();
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Security advisory (SD-2026-001): An example advisory for the tests.");
    expect(banner).toHaveTextContent("update to 1.1.0 or newer");
    expect(banner).toHaveClass("banner-alarm");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("raises one banner per advisory the version falls in", async () => {
    const policy = {
      ...compatResponse,
      mod: {
        ...compatResponse.mod,
        advisories: [
          { id: "SD-1", affected: "<1.1.0", fixed: "1.1.0", summary: "first" },
          { id: "SD-2", affected: "<1.0.9", fixed: "1.0.9", summary: "second" },
        ],
      },
    };
    reports("mod/1.0.5", policy);
    renderBanners();
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(2));
  });

  it("raises a generic security banner for a version below minSafe with no advisory", async () => {
    reports("0.2.5");
    renderBanners();
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("This version has a known security problem");
    expect(banner).toHaveTextContent("update to 0.3.0 or newer");
    expect(banner).toHaveClass("banner-alarm");
  });

  it("does not let an advisory be dismissed", async () => {
    reports("mod/1.0.5");
    renderBanners();
    await screen.findByRole("status");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("dismisses 'update available' for that release only, and remembers it", async () => {
    reports("0.3.5");
    const first = renderBanners();
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the agent update notice" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    first.unmount();

    // Another visit: still hidden for 0.4.0.
    const second = renderBanners();
    await new Promise((r) => setTimeout(r, 50));
    expect(second.container).toBeEmptyDOMElement();
    second.unmount();

    // A newer release brings the banner back.
    reports("0.3.5", { ...compatResponse, agent: { ...compatResponse.agent, current: "0.5.0" } });
    renderBanners();
    expect(await screen.findByRole("status")).toHaveTextContent("the newest is 0.5.0");
  });

  it("keeps the mod and agent dismissals apart", async () => {
    window.localStorage.setItem(`satis-manager.dismissed-update.${summary.id}.mod`, "1.2.0");
    reports("0.3.5");
    renderBanners();
    expect(await screen.findByRole("status")).toHaveTextContent("game PC agent");
  });

  it("still hides it for this view when storage throws", async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      reports("0.3.5");
      renderBanners();
      await screen.findByRole("status");
      fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("ServerUpdateLine", () => {
  function renderLine() {
    return renderWithClient(<ServerUpdateLine serverId="default" />);
  }

  it("shows nothing for a server that needs nothing", async () => {
    reports("0.4.0");
    const { container } = renderLine();
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });

  it("gives the update line, the unsupported line and the advisory line, each in its tone", async () => {
    reports("0.3.5");
    const update = renderLine();
    expect(await screen.findByText(/Update available: the game PC agent is 0\.3\.5/)).toHaveClass("text-muted");
    update.unmount();

    reports("0.1.5", { ...compatResponse, agent: { ...compatResponse.agent, minSafe: "0.1.0" } });
    const unsupported = renderLine();
    expect(await screen.findByText(/Unsupported version/)).toHaveClass("text-warn");
    unsupported.unmount();

    reports("mod/1.0.5");
    renderLine();
    expect(await screen.findByText(/Security advisory/)).toHaveClass("text-bad");
  });
});
