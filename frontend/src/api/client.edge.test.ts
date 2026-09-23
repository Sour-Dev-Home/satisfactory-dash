import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints, type StatusResponse } from "@satisfactory-dash/shared";
import { errorSessionRequired, serversSingle, statusRunning } from "@satisfactory-dash/shared/fixtures";
import { server } from "../test/server";
import { apiGet } from "./client";
import { ApiError, BackendUnreachableError, classifyError, ContractDriftError } from "./errors";

// Fresh-eyes pass over response parsing: what the browser really gets in production when
// something other than the backend answers (the SPA fallback, a proxy page) or the body is odd.

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the request to fail");
}

const INDEX_HTML = '<!doctype html><html><head><title>Satis Manager</title></head><body><div id="root"></div></body></html>';

describe("apiGet response parsing (edge cases)", () => {
  it("reports the SPA fallback (200 text/html index.html) as contract drift, not data", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.html(INDEX_HTML)));
    const error = await caught(apiGet(endpoints.servers));
    expect(error).toBeInstanceOf(ContractDriftError);
    expect(error).toMatchObject({ path: "/api/servers", status: 200, issues: ["body is not JSON"] });
  });

  it("treats an HTML 404 page as something in front of the backend", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.html("<h1>Not Found</h1>", { status: 404 })));
    const error = await caught(apiGet(endpoints.servers));
    expect(error).toBeInstanceOf(BackendUnreachableError);
    expect(error).toMatchObject({ status: 404 });
  });

  it("does not sign out on a 401 whose body is an HTML page (not the backend's envelope)", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.html("<h1>Access denied</h1>", { status: 401 })));
    const error = await caught(apiGet(endpoints.servers));
    expect(classifyError(error)).toBe("backend_unreachable");
  });

  it("treats an empty 200 body as contract drift", async () => {
    server.use(http.get(endpoints.servers.route, () => new HttpResponse(null, { status: 200 })));
    const error = await caught(apiGet(endpoints.servers));
    expect(error).toBeInstanceOf(ContractDriftError);
  });

  it("treats an empty 5xx body as the backend being unreachable", async () => {
    server.use(http.get(endpoints.servers.route, () => new HttpResponse(null, { status: 503 })));
    const error = await caught(apiGet(endpoints.servers));
    expect(error).toBeInstanceOf(BackendUnreachableError);
    expect(error).toMatchObject({ status: 503 });
  });

  it("treats truncated JSON as contract drift", async () => {
    server.use(
      http.get(endpoints.servers.route, () =>
        HttpResponse.text('{"servers":[{"id":"default"', { headers: { "Content-Type": "application/json" } }),
      ),
    );
    expect(await caught(apiGet(endpoints.servers))).toBeInstanceOf(ContractDriftError);
  });

  it("treats a JSON null body as contract drift without crashing", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.json(null)));
    const error = await caught(apiGet(endpoints.servers));
    expect(error).toBeInstanceOf(ContractDriftError);
    expect((error as ContractDriftError).issues[0]).toMatch(/^\(root\): /);
  });

  it("accepts extra fields the contract doesn't know yet (additive change, ADR-0007)", async () => {
    server.use(
      http.get(endpoints.servers.route, () => HttpResponse.json({ ...serversSingle, nextCursor: "x", extra: 1 })),
    );
    await expect(apiGet(endpoints.servers)).resolves.toEqual(serversSingle);
  });

  it("names the field when JSON almost matches the schema", async () => {
    const drifted = { ...statusRunning, stale: "false" };
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(drifted)));
    const error = await caught(apiGet(endpoints.status, "default"));
    expect(error).toBeInstanceOf(ContractDriftError);
    expect((error as ContractDriftError).issues.some((issue) => issue.startsWith("stale: "))).toBe(true);
  });

  it("rejects an observedAt that isn't an ISO UTC datetime", async () => {
    const drifted = { ...statusRunning, observedAt: "yesterday" } satisfies StatusResponse;
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(drifted)));
    expect(await caught(apiGet(endpoints.status, "default"))).toBeInstanceOf(ContractDriftError);
  });

  it("caps the reported issues at five", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.json({ data: {} })));
    const error = await caught(apiGet(endpoints.status, "default"));
    expect((error as ContractDriftError).issues).toHaveLength(5);
  });

  it("treats an error envelope missing requestId as contract drift, keeping the status", async () => {
    const { requestId: _omitted, ...rest } = errorSessionRequired.error;
    server.use(http.get(endpoints.servers.route, () => HttpResponse.json({ error: rest }, { status: 401 })));
    const error = await caught(apiGet(endpoints.servers));
    expect(error).toBeInstanceOf(ContractDriftError);
    expect(error).toMatchObject({ status: 401 });
  });

  it("classifies a well-formed 401 envelope as unauthorized", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.json(errorSessionRequired, { status: 401 })));
    const error = await caught(apiGet(endpoints.servers));
    expect(error).toBeInstanceOf(ApiError);
    expect(classifyError(error)).toBe("unauthorized");
  });

  it("treats a connection that drops mid-body as the backend being unreachable, not drift", async () => {
    // Headers arrived (200) but the body stream failed: no response body was ever received,
    // so this is the same condition as a failed request, and it should get the one retry.
    server.use(
      http.get(endpoints.servers.route, () => {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"servers":['));
            controller.error(new TypeError("network connection lost"));
          },
        });
        return new HttpResponse(body, { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    const error = await caught(apiGet(endpoints.servers));
    expect(error).toBeInstanceOf(BackendUnreachableError);
  });
});

describe("VITE_API_URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("ignores surrounding whitespace and trailing slashes", async () => {
    vi.stubEnv("VITE_API_URL", "  https://api.example.test//  ");
    vi.resetModules();
    const { apiGet: freshGet } = await import("./client");
    let hit = "";
    server.use(
      http.get("https://api.example.test/api/servers", ({ request }) => {
        hit = request.url;
        return HttpResponse.json(serversSingle);
      }),
    );
    await expect(freshGet(endpoints.servers)).resolves.toEqual(serversSingle);
    expect(hit).toBe("https://api.example.test/api/servers");
  });

  it("uses same-origin paths when the variable is blank", async () => {
    vi.stubEnv("VITE_API_URL", "   ");
    vi.resetModules();
    const { apiGet: freshGet } = await import("./client");
    await expect(freshGet(endpoints.servers)).resolves.toEqual(serversSingle);
  });
});
