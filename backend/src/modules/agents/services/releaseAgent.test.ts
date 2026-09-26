import { describe, expect, it } from "vitest";
import { releaseAgentServer } from "./releaseAgent.js";

/** ADR-0031 amendment: what the agent side lets go of when a server is switched back to local. SQL is checked here by shape; the
 *  real statements run against Postgres in switchToLocal.db.test.ts (CI). */

function fakeDb(rowsFor: (text: string) => unknown[]) {
  const log: { text: string; values: unknown[] }[] = [];
  return {
    log,
    db: {
      query: async (text: string, values: unknown[] = []) => {
        log.push({ text, values });
        return { rows: rowsFor(text), rowCount: rowsFor(text).length };
      },
    },
  };
}

describe("releaseAgentServer", () => {
  it("drops the unspent enrolment codes, revokes the credential and ends the waiting commands, all for THIS server only, and reports counts", async () => {
    const { db, log } = fakeDb((text) => (text.includes("UPDATE agents.commands") ? [{ id: "c1" }, { id: "c2" }] : text.includes("UPDATE agents.agent_credentials") ? [{ server_id: "s" }] : []));
    const result = await releaseAgentServer(db as never, "uuid-alex");
    expect(result).toEqual({ credentialRevoked: true, commandsEnded: 2 });
    const shapes = log.map((entry) => entry.text.replace(/\s+/g, " ").trim());
    expect(shapes[0]).toMatch(/^DELETE FROM agents\.enrollment_codes WHERE server_id = \$1/);
    expect(shapes[1]).toMatch(/^UPDATE agents\.agent_credentials SET revoked_at = now\(\) WHERE server_id = \$1/);
    expect(shapes[2]).toMatch(/^UPDATE agents\.commands SET status = 'expired', completed_at = now\(\) WHERE server_id = \$1/);
    expect(shapes).toHaveLength(3);
    for (const entry of log) expect(entry.values[0]).toBe("uuid-alex"); // scoped by the server, never a table-wide change
  });

  it("the codes are dropped BEFORE the credential is revoked, so no window has a live code and no agent", async () => {
    const { db, log } = fakeDb(() => []);
    await releaseAgentServer(db as never, "uuid-alex");
    expect(log[0]!.text).toContain("enrollment_codes");
    expect(log[1]!.text).toContain("agent_credentials");
  });

  it("a server with no credential and no waiting commands reports false and 0 (nothing to release is not an error)", async () => {
    const { db } = fakeDb(() => []);
    expect(await releaseAgentServer(db as never, "uuid-alex")).toEqual({ credentialRevoked: false, commandsEnded: 0 });
  });

  it("ends commands as the existing terminal state `expired` (never `failed`, which is a result the agent reported), and only pending or sent ones", async () => {
    const { db, log } = fakeDb(() => []);
    await releaseAgentServer(db as never, "uuid-alex");
    const statement = log.find((entry) => entry.text.includes("agents.commands"))!.text;
    expect(statement).toContain("status = 'expired'");
    expect(statement).toMatch(/status IN \('pending', 'sent'\)/);
    expect(statement).not.toContain("'failed'");
  });
});
