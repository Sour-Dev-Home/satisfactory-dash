import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  errorLoginFailed,
  errorUnknownCode,
  errorUpstreamUnreachable,
  errorWithDetail,
  loginRequestValid,
  sessionAnonymous,
  sessionAuthenticated,
  setAutoPauseRequestOn,
  settingsPending,
  statusRunning,
} from "@satisfactory-dash/shared/fixtures";
import { server } from "../test/server";
import { apiGet, apiSend } from "./client";
import { ApiError, BackendUnreachableError, ContractDriftError } from "./errors";

/** Resolves to whatever apiGet/apiSend threw, failing the test if it didn't throw. */
async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the request to fail");
}

describe("apiGet", () => {
  it("returns the parsed body on success", async () => {
    await expect(apiGet(endpoints.status, "default")).resolves.toEqual(statusRunning);
  });

  it("builds server-scoped paths with the id encoded", async () => {
    let seen = "";
    server.use(
      http.get(endpoints.status.route, ({ params }) => {
        seen = String(params.serverId);
        return HttpResponse.json(statusRunning);
      }),
    );
    await apiGet(endpoints.status, "a b/c");
    expect(seen).toBe("a b/c");
  });

  it("sends credentials with every request", async () => {
    let credentials = "";
    server.use(
      http.get(endpoints.servers.route, ({ request }) => {
        credentials = request.credentials;
        return HttpResponse.json({ servers: [] });
      }),
    );
    await apiGet(endpoints.servers);
    expect(credentials).toBe("include");
  });

  it("throws ApiError with status, code, message and requestId for an error envelope", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })));
    const error = await caught(apiGet(endpoints.status, "default"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 502,
      code: "upstream_unreachable",
      message: errorUpstreamUnreachable.error.message,
      requestId: errorUpstreamUnreachable.error.requestId,
      detail: undefined,
    });
  });

  it("keeps the dev-only detail when the backend sends it", async () => {
    server.use(http.get(endpoints.power.route, () => HttpResponse.json(errorWithDetail, { status: 502 })));
    const error = await caught(apiGet(endpoints.power, "default"));
    expect(error).toMatchObject({ code: "upstream_invalid_response", detail: errorWithDetail.error.detail });
  });

  it("passes an unknown error code through instead of failing the parse (ADR-0003)", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(errorUnknownCode, { status: 500 })));
    const error = await caught(apiGet(endpoints.status, "default"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "some_future_code", requestId: errorUnknownCode.error.requestId });
  });

  it("throws ContractDriftError when a success body doesn't match the schema", async () => {
    const drifted = { ...statusRunning, data: { ...statusRunning.data, gamePaused: "no" } };
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(drifted)));
    const error = await caught(apiGet(endpoints.status, "default"));
    expect(error).toBeInstanceOf(ContractDriftError);
    expect(error).toMatchObject({ path: "/api/servers/default/status", status: 200 });
    expect((error as ContractDriftError).issues).toEqual([expect.stringMatching(/^data\.gamePaused: /)]);
  });

  it("throws ContractDriftError when an error body isn't the envelope", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.json({ message: "nope" }, { status: 500 })));
    const error = await caught(apiGet(endpoints.status, "default"));
    expect(error).toBeInstanceOf(ContractDriftError);
    expect(error).toMatchObject({ status: 500 });
  });

  it("throws ContractDriftError when a success body isn't JSON", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.text("<html></html>")));
    const error = await caught(apiGet(endpoints.servers));
    expect(error).toBeInstanceOf(ContractDriftError);
    expect((error as ContractDriftError).issues).toEqual(["body is not JSON"]);
  });

  it("throws BackendUnreachableError when a proxy answers with a non-JSON error page", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.text("Bad Gateway", { status: 502 })));
    const error = await caught(apiGet(endpoints.servers));
    expect(error).toBeInstanceOf(BackendUnreachableError);
    expect(error).toMatchObject({ status: 502, path: "/api/servers" });
  });

  it("throws BackendUnreachableError when the request gets no response", async () => {
    server.use(http.get(endpoints.servers.route, () => HttpResponse.error()));
    const error = await caught(apiGet(endpoints.servers));
    expect(error).toBeInstanceOf(BackendUnreachableError);
    expect(error).toMatchObject({ status: undefined });
  });
});

describe("apiSend", () => {
  it("sends the body as JSON and parses the response", async () => {
    let body: unknown;
    let contentType: string | null = null;
    server.use(
      http.post(endpoints.auth.login.route, async ({ request }) => {
        contentType = request.headers.get("content-type");
        body = await request.json();
        return HttpResponse.json(sessionAuthenticated);
      }),
    );
    await expect(apiSend(endpoints.auth.login, loginRequestValid)).resolves.toEqual(sessionAuthenticated);
    expect(body).toEqual(loginRequestValid);
    expect(contentType).toBe("application/json");
  });

  it("uses the endpoint's method and path arguments", async () => {
    let method = "";
    server.use(
      http.put(endpoints.settings.setAutoPause.route, async ({ request }) => {
        method = request.method;
        return HttpResponse.json(settingsPending);
      }),
    );
    await expect(apiSend(endpoints.settings.setAutoPause, setAutoPauseRequestOn, "default")).resolves.toEqual(
      settingsPending,
    );
    expect(method).toBe("PUT");
  });

  it("sends no body or content type when the body is undefined", async () => {
    let text = "unset";
    let contentType: string | null = "unset";
    server.use(
      http.post(endpoints.auth.logout.route, async ({ request }) => {
        contentType = request.headers.get("content-type");
        text = await request.text();
        return HttpResponse.json(sessionAnonymous);
      }),
    );
    await apiSend(endpoints.auth.logout, undefined);
    expect(text).toBe("");
    expect(contentType).toBeNull();
  });

  it("throws ApiError for a failed login, carrying the message to show", async () => {
    server.use(http.post(endpoints.auth.login.route, () => HttpResponse.json(errorLoginFailed, { status: 401 })));
    const error = await caught(apiSend(endpoints.auth.login, loginRequestValid));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "unauthorized", message: "Invalid username or password" });
  });
});
