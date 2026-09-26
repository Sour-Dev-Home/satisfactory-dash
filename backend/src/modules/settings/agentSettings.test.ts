import { describe, expect, it } from "vitest";
import request from "supertest";
import { ApiErrorResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { InMemoryServerDirectory } from "../servers/index.js";
import { createAgentSettingsServices, createSettingsRouters } from "./index.js";

// ADR-0031 PR 5a: until the auto-pause command exists (PR 5b), the setting of a server reached through an agent can
// neither be read nor changed, and says so with the contract's existing codes.
describe("the settings of an agent-backed server", () => {
  const directory = new InMemoryServerDirectory([{ id: "alpha", displayName: "Alpha", services: { settings: createAgentSettingsServices() } }]);
  const app = createApp({ logger: createLogger({ level: "silent" }, { write: () => {} }), routers: createSettingsRouters(directory) });

  it("cannot be read: the server's data is not available through its agent yet", async () => {
    const res = await request(app).get(endpoints.settings.get.path("alpha"));
    expect(res.status).toBe(503);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("upstream_unreachable");
  });

  it("cannot be changed: 409 not_editable, so the UI shows it read-only", async () => {
    const res = await request(app).put(endpoints.settings.setAutoPause.path("alpha")).send({ enabled: true });
    expect(res.status).toBe(409);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("not_editable");
  });
});
