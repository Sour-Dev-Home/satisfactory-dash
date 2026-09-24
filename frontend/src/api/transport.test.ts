import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { statusRunning } from "@satisfactory-dash/shared/fixtures";

// ADR-0026's transport seam: client.ts builds the request, transport.ts sends it. The
// production transport must behave exactly as the inline fetch did before the seam.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock("./transport");
});

async function loadTransport(apiUrl: string) {
  vi.stubEnv("VITE_API_URL", apiUrl);
  vi.resetModules();
  return (await import("./transport")).transport;
}

describe("the production transport", () => {
  it("sends to VITE_API_URL plus the path, with the init unchanged", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    const transport = await loadTransport("https://api.example.test");
    const init: RequestInit = { method: "GET", credentials: "include" };
    await transport("/api/health", init);
    expect(fetchSpy).toHaveBeenCalledWith("https://api.example.test/api/health", init);
  });

  it("trims spaces and trailing slashes from VITE_API_URL", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    const transport = await loadTransport("  https://api.example.test//  ");
    await transport("/api/health", {});
    expect(fetchSpy).toHaveBeenCalledWith("https://api.example.test/api/health", {});
  });

  it("stays same-origin when VITE_API_URL is empty (development, behind Vite's proxy)", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    const transport = await loadTransport("");
    await transport("/api/health", {});
    expect(fetchSpy).toHaveBeenCalledWith("/api/health", {});
  });
});

describe("the client sends every request through the transport", () => {
  it("passes the path and the same init the inline fetch used: method, cookie, JSON body, signal", async () => {
    const sent: [string, RequestInit][] = [];
    vi.doMock("./transport", () => ({
      transport: async (path: string, init: RequestInit) => {
        sent.push([path, init]);
        return new Response(JSON.stringify(statusRunning), { status: 200 });
      },
    }));
    const { apiGetAbortable, apiSend } = await import("./client");

    const controller = new AbortController();
    await apiGetAbortable(controller.signal, endpoints.status, "default");
    expect(sent[0]).toEqual([
      endpoints.status.path("default"),
      { method: "GET", credentials: "include", signal: controller.signal },
    ]);

    await apiSend(endpoints.auth.login, { username: "operator", password: "pw" }).catch(() => {});
    expect(sent[1]).toEqual([
      endpoints.auth.login.path(),
      {
        method: "POST",
        credentials: "include",
        signal: undefined,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "operator", password: "pw" }),
      },
    ]);
  });
});
