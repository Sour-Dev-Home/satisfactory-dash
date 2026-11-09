import { describe, it, expect } from "vitest";
import request from "supertest";
import { ServerPlayersResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { createTelemetryRouters } from "../index.js";
import type { TelemetryServices } from "../index.js";

// ADR-0029: who is connected, name and online only. Since ADR-0066 the list is the one the mod last sent (the FRM-based
// cases went with the polled service); what stays is the route and the rule that a name is never logged.
function build(players: TelemetryServices["players"]) {
  const lines: string[] = [];
  const unused = (): never => {
    throw new Error("not used here");
  };
  const telemetry: TelemetryServices = {
    status: { getStatus: unused },
    production: { getFactoryOverview: unused },
    power: { getPowerOverview: unused },
    powerHistory: { getPowerHistory: unused },
    players,
  };
  const directory = new InMemoryServerDirectory([{ id: "default", displayName: "Home", services: { telemetry } }]);
  const app = createApp({
    // Everything, at the most verbose level, so anything that could log a name would.
    logger: createLogger({ level: "trace" }, { write: (line: string) => lines.push(line) }),
    allowedOrigins: [],
    routers: createTelemetryRouters(directory),
  });
  return { app, lines };
}

describe("GET /api/servers/:serverId/players (ADR-0029)", () => {
  it("serves the list in the contract's shape, and no name appears in any log line", async () => {
    const { app, lines } = build({ getPlayers: async () => ({ available: true, players: [{ name: "SecretPioneerName", online: true }] }) });
    const res = await request(app).get(endpoints.players.path("default"));
    expect(res.status).toBe(200);
    expect(ServerPlayersResponseSchema.parse(res.body)).toMatchObject({ available: true, players: [{ name: "SecretPioneerName", online: true }] });
    expect(lines.length).toBeGreaterThan(0); // the request WAS logged, so the assertion below has teeth
    expect(lines.join("\n")).not.toContain("SecretPioneerName");
  });

  it("answers an unknown server with 404 server_not_found", async () => {
    const { app } = build({ getPlayers: async () => ({ available: false, players: [] }) });
    const res = await request(app).get(endpoints.players.path("nope"));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("server_not_found");
  });
});

// ADR-0029 decision 4: never logged.
describe("players and the logs (ADR-0029 decision 4)", () => {
  it("the redact paths censor a players payload if a log call ever includes one", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "info" }, { write: (line: string) => lines.push(line) });
    const payload = [{ name: "SecretPioneerName", online: true }];
    logger.info({ players: payload }, "direct");
    logger.info({ data: { players: payload } }, "nested once");
    logger.info({ res: { body: { players: payload } } }, "nested twice");
    const text = lines.join("\n");
    expect(text).not.toContain("SecretPioneerName");
    expect(text.match(/\[Redacted\]/g)).toHaveLength(3);
  });
});
