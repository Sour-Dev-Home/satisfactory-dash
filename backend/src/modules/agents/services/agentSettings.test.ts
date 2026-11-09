import express from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { ApiErrorResponseSchema, SetAutoPauseResponseSchema, SettingsResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { commandPending } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../../app.js";
import { ApiFailure, NotEditableError } from "../../../platform/errorResponse.js";
import { createLogger } from "../../../platform/logger.js";
import { createSettingsRouters } from "../../settings/index.js";
import type { SettingsScope } from "../../settings/index.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { createAgentSettingsServices } from "./agentSettings.js";
import type { CommandsService } from "./commandsService.js";

// ADR-0031 PR 5b: the auto-pause of a server reached through an edge agent is a COMMAND (202). ADR-0066: the only kind.

const commandsStub = () => ({
  readAutoPause: vi.fn<CommandsService["readAutoPause"]>(async () => ({ autoPause: false, pending: false, editable: true })),
  requestAutoPause: vi.fn<CommandsService["requestAutoPause"]>(async () => commandPending.command),
});

describe("createAgentSettingsServices", () => {
  it("reads the setting from the commands service, for its own server", async () => {
    const commands = commandsStub();
    const settings = await createAgentSettingsServices(commands, "alpha").getSettings();
    expect(settings).toEqual({ autoPause: false, pending: false, editable: true });
    expect(commands.readAutoPause).toHaveBeenCalledWith("alpha", undefined);
  });

  it("hands the agent's latest reported reading to the commands service, read at the moment of the request", async () => {
    const commands = commandsStub();
    let reading: { autoPause: boolean; observedAtMs: number; stale: boolean } | undefined;
    const service = createAgentSettingsServices(commands, "alpha", () => reading);
    await service.getSettings();
    reading = { autoPause: true, observedAtMs: 1000, stale: false };
    await service.getSettings();
    expect(commands.readAutoPause.mock.calls).toEqual([["alpha", undefined], ["alpha", { autoPause: true, observedAtMs: 1000, stale: false }]]);
  });

  it("changing it creates a command and returns it, passing who asked", async () => {
    const commands = commandsStub();
    const result = await createAgentSettingsServices(commands, "alpha").setAutoPause(true, { actorUserId: "user-1" });
    expect(result).toEqual({ command: commandPending.command });
    expect(commands.requestAutoPause).toHaveBeenCalledWith("alpha", true, "user-1");
  });

  it("works without a context (no actor)", async () => {
    const commands = commandsStub();
    await createAgentSettingsServices(commands, "alpha").setAutoPause(false);
    expect(commands.requestAutoPause).toHaveBeenCalledWith("alpha", false, undefined);
  });
});

// ADR-0066: every server is reached through the mod, so the PUT always answers 202 with a command (no 200 any more).
describe("the settings routes", () => {
  function build() {
    const commands = commandsStub();
    const directory = new InMemoryServerDirectory<SettingsScope>([
      { id: "alpha", displayName: "Alpha", services: { settings: createAgentSettingsServices(commands, "alpha") } },
      { id: "bravo", displayName: "Bravo", services: { settings: createAgentSettingsServices(commands, "bravo") } },
    ]);
    const lines: string[] = [];
    const asUser = express.Router().use((_req, res, next) => {
      res.locals.user = { id: "user-1", name: "Ann" };
      next();
    });
    const app = createApp({
      logger: createLogger({ level: "info" }, { write: (line: string) => lines.push(line) }),
      routers: [asUser, ...createSettingsRouters(directory)],
    });
    return { app, commands, lines };
  }
  const put = (app: ReturnType<typeof build>["app"], serverId: string, body: unknown) =>
    request(app).put(endpoints.settings.setAutoPause.path(serverId)).set("Content-Type", "application/json").send(JSON.stringify(body));

  it("an agent server answers 202 with the command (the contract's additive shape), and asks the agent, not the game", async () => {
    const { app, commands } = build();
    const res = await put(app, "alpha", { enabled: true });
    expect(res.status).toBe(202);
    expect(SetAutoPauseResponseSchema.parse(res.body)).toEqual({ command: commandPending.command });
    expect(commands.requestAutoPause).toHaveBeenCalledWith("alpha", true, "user-1");
  });

  it("every server answers 202 and a command is created for that server (no direct write, ADR-0066)", async () => {
    const { app, commands } = build();
    const res = await put(app, "bravo", { enabled: false });
    expect(res.status).toBe(202);
    expect(SetAutoPauseResponseSchema.parse(res.body)).toEqual({ command: commandPending.command });
    expect(commands.requestAutoPause).toHaveBeenCalledWith("bravo", false, "user-1");
  });

  it("logs that a change was sent to the agent, with the command id and the user, and not the target value", async () => {
    const { app, lines } = build();
    await put(app, "alpha", { enabled: true });
    const line = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.msg === "auto-pause change sent to the agent");
    expect(line).toMatchObject({ audit: "auto-pause", serverId: "alpha", user: "Ann", commandId: commandPending.command.id });
    expect(line).not.toHaveProperty("requested");
  });

  it("reads an agent server's setting through GET, with its pending and editable flags", async () => {
    const { app, commands } = build();
    commands.readAutoPause.mockResolvedValue({ autoPause: true, pending: true, editable: true });
    const res = await request(app).get(endpoints.settings.get.path("alpha"));
    expect(res.status).toBe(200);
    expect(SettingsResponseSchema.parse(res.body).data).toEqual({ autoPause: true, pending: true, editable: true });
  });

  it("an agent server with no enrolled agent is not editable (409 not_editable), and no command is made", async () => {
    const { app, commands } = build();
    commands.requestAutoPause.mockRejectedValue(new NotEditableError());
    const res = await put(app, "alpha", { enabled: true });
    expect(res.status).toBe(409);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("not_editable");
  });

  it("before the agent has confirmed anything the value is unknown: 503 upstream_unreachable, not a guess", async () => {
    const { app, commands } = build();
    commands.readAutoPause.mockRejectedValue(new ApiFailure("upstream_unreachable", "not known yet"));
    const res = await request(app).get(endpoints.settings.get.path("alpha"));
    expect(res.status).toBe(503);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("upstream_unreachable");
  });

  it("a body that is not { enabled: boolean } is a 400, and asks nobody", async () => {
    const { app, commands } = build();
    for (const serverId of ["alpha", "bravo"]) {
      expect((await put(app, serverId, { enabled: "yes" })).status).toBe(400);
    }
    expect(commands.requestAutoPause).not.toHaveBeenCalled();
  });
});
