import { describe, it, expect } from "vitest";
import request from "supertest";
import { endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { FrmApiClient, SatisfactoryServerAdapter } from "../../gameserver/index.js";
import { createTelemetryServices, createTelemetryRouters } from "../index.js";

/** Builds the app over a REAL FrmApiClient whose fetch answers with `body`, so the whole error
 *  chain (client -> adapter -> service -> error handler -> log) is exercised. */
function build(body: string) {
  const lines: string[] = [];
  const frm = new FrmApiClient({
    host: "h",
    port: 1,
    timeoutMs: 1000,
    fetchImpl: (async () => new Response(body, { status: 200 })) as never,
  });
  const adapter = new SatisfactoryServerAdapter({ call: async () => Promise.reject(new Error("unused")) }, frm);
  const directory = new InMemoryServerDirectory([
    { id: "default", displayName: "Home", services: { telemetry: createTelemetryServices(adapter) } },
  ]);
  const app = createApp({
    logger: createLogger({ level: "trace" }, { write: (line: string) => lines.push(line) }),
    allowedOrigins: [],
    routers: createTelemetryRouters(directory),
  });
  return { app, lines };
}

describe("players: no name in logs or bodies on a bad FRM response (ADR-0029)", () => {
  it.each([
    ["malformed JSON, name near the start", '<html>SecretAlice</html>'],
    ["malformed JSON, name near the error", '[{"Name":"SecretAlice","Online":tru}]'],
    ["Online is a string", '[{"Name":"SecretAlice","Online":"yes"}]'],
    ["Online is missing", '[{"Name":"SecretAlice"}]'],
    ["Name is a number in a second entry", '[{"Name":"SecretAlice","Online":true},{"Name":5,"Online":true}]'],
    ["not an array", '{"Name":"SecretAlice","Online":true}'],
  ])("%s: 502, and neither the log nor the body contains the name", async (_label, body) => {
    const { app, lines } = build(body);
    const res = await request(app).get(endpoints.players.path("default"));
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("SecretAlice");
    expect(lines.join("\n")).not.toContain("SecretAlice");
  });

  it("returns duplicate, empty and very long names untouched, for hundreds of players", async () => {
    const long = "x".repeat(5000);
    const many = Array.from({ length: 500 }, (_, i) => ({ Name: i % 2 ? "Dup" : "", Online: i % 3 === 0 }));
    const { app } = build(JSON.stringify([...many, { Name: long, Online: true }]));
    const res = await request(app).get(endpoints.players.path("default"));
    expect(res.status).toBe(200);
    expect(res.body.players).toHaveLength(501);
    expect(res.body.players[500]).toEqual({ name: long, online: true });
  });

  it("is GET only", async () => {
    const { app } = build("[]");
    for (const method of ["post", "put", "patch", "delete"] as const) {
      const res = await request(app)[method](endpoints.players.path("default"));
      expect([404, 405]).toContain(res.status);
    }
  });
});
