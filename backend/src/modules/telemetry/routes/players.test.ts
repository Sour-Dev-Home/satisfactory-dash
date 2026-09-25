import { describe, it, expect } from "vitest";
import request from "supertest";
import { ApiErrorResponseSchema, ServerPlayersResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { FrmApiRequestError, SatisfactoryServerAdapter } from "../../gameserver/index.js";
import { createTelemetryServices, createTelemetryRouters } from "../index.js";

// What FRM really sends per player (docs-vault/raw-sources/frm-getPlayer.md), with values that must
// never show up anywhere: a name is personal data about a third party, the rest is not ours to keep.
const FRM_PLAYER = {
  ID: "Char_Player_C_SECRETID999",
  Name: "SecretPioneerName",
  ClassName: "Char_Player_C",
  location: { x: -57604.5, y: 260436.25, z: -3018.5, rotation: 115.5 },
  Online: true,
  PlayerHP: 87.5,
  Speed: 1234.5,
  Dead: false,
  Inventory: [{ Name: "SecretInventoryItem", ClassName: "Desc_X_C", Amount: 42, MaxAmount: 100 }],
};

function build(frmGet: () => Promise<unknown>) {
  const lines: string[] = [];
  const adapter = new SatisfactoryServerAdapter(
    { call: async () => Promise.reject(new Error("vanilla is not used here")) },
    { get: frmGet as never },
  );
  const directory = new InMemoryServerDirectory([
    { id: "default", displayName: "Home", services: { telemetry: createTelemetryServices(adapter) } },
  ]);
  const app = createApp({
    // Everything, at the most verbose level, so anything that could log a name would.
    logger: createLogger({ level: "trace" }, { write: (line: string) => lines.push(line) }),
    allowedOrigins: [],
    routers: createTelemetryRouters(directory),
  });
  return { app, lines };
}

describe("GET /api/servers/:serverId/players (ADR-0029)", () => {
  it("returns name and online ONLY, matching the contract; FRM's ID, location, HP, speed and inventory never leave the adapter", async () => {
    const { app } = build(async () => [FRM_PLAYER, { ...FRM_PLAYER, Name: "Sleeper", Online: false }]);
    const res = await request(app).get(endpoints.players.path("default"));
    expect(res.status).toBe(200);
    expect(ServerPlayersResponseSchema.parse(res.body)).toEqual(res.body);
    expect(res.body).toEqual({
      available: true,
      players: [
        { name: "SecretPioneerName", online: true },
        { name: "Sleeper", online: false },
      ],
    });
    const text = JSON.stringify(res.body);
    for (const leaked of ["SECRETID999", "260436", "87.5", "1234.5", "SecretInventoryItem", "Char_Player_C"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it.each([
    ["unreachable", new FrmApiRequestError("connect failed", undefined, { failureKind: "unreachable" })],
    ["not installed (404)", new FrmApiRequestError("not found", 404)],
  ])("answers 200 available:false when FRM is %s", async (_name, err) => {
    const { app } = build(async () => Promise.reject(err));
    const res = await request(app).get(endpoints.players.path("default"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, players: [] });
  });

  it("answers 502 upstream_invalid_response when FRM sent something that fails validation", async () => {
    const { app } = build(async () => [{ Name: "SecretPioneerName", Online: "yes" }]);
    const res = await request(app).get(endpoints.players.path("default"));
    expect(res.status).toBe(502);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("upstream_invalid_response");
    expect(JSON.stringify(res.body)).not.toContain("SecretPioneerName");
  });

  it("answers an unknown server with 404 server_not_found", async () => {
    const { app } = build(async () => []);
    const res = await request(app).get(endpoints.players.path("other"));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("server_not_found");
  });
});

// ADR-0029 decision 4: never logged. The log output of real players requests is captured at trace
// level and must contain no name, id, position or inventory, on success, on "FRM absent" and on an
// upstream validation failure (whose error is logged with its cause).
describe("players and the logs (ADR-0029 decision 4)", () => {
  const secrets = ["SecretPioneerName", "SecretInventoryItem", "SECRETID999", "260436", "87.5", "1234.5"];

  it.each([
    ["success", async () => [FRM_PLAYER]],
    ["FRM unreachable", async () => Promise.reject(new FrmApiRequestError("down", undefined, { failureKind: "unreachable" }))],
    ["an invalid FRM response", async () => [{ ...FRM_PLAYER, Online: "yes" }]],
    ["a non-array FRM body carrying names", async () => ({ players: [FRM_PLAYER] })],
  ])("no player data appears in any log line: %s", async (_name, frmGet) => {
    const { app, lines } = build(frmGet as () => Promise<unknown>);
    await request(app).get(endpoints.players.path("default"));
    expect(lines.length).toBeGreaterThan(0); // the request WAS logged, so the assertion below has teeth
    const text = lines.join("\n");
    for (const secret of secrets) {
      expect(text).not.toContain(secret);
    }
  });

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
