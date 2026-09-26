import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { InMemoryServerDirectory, ServerRuntime } from "../../servers/index.js";
import type { TelemetryScope } from "../../telemetry/index.js";
import { ObservationBoard } from "../../telemetry/services/observationBoard.js";
import { AlertEvaluatorWorker, type AlertsDb } from "./alertEvaluatorWorker.js";

const SEC = 1000;
const MIN = 60 * SEC;
const T0 = 1_800_000_000_000;

interface RuleFixture {
  id: string;
  server_public_id: string;
  kind: string;
  params: unknown;
  for_seconds: number;
  clear_seconds: number;
  repeat_seconds: number;
  severity: string;
}

/**
 * A tiny in-memory stand-in for the alerts tables that understands the repository's SQL by its text and its parameter
 * arrays: enough to run whole ticks (seed, read, evaluate, write, purge) without Postgres.
 */
function fakeDb(initialRules: RuleFixture[] = []) {
  const rules = [...initialRules];
  const states = new Map<string, Record<string, unknown>>();
  const events: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const mutes = new Map<string, number>();
  const failWhen: { events: boolean; list: boolean; eventsFor?: string; enqueue?: boolean } = { events: false, list: false };
  const insertedIds: { id: string }[] = [];
  const outbox: string[] = [];
  const log: string[] = [];

  const handle = (sql: string, params: unknown[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) {
      log.push(sql);
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO alerts.rules")) {
      calls.push("seed");
      const serverId = params[0] as string;
      const kinds = params[1] as string[];
      kinds.forEach((kind, i) => {
        if (rules.some((rule) => rule.server_public_id === serverId && rule.kind === kind)) return;
        rules.push({
          id: `${serverId}-${kind}`,
          server_public_id: serverId,
          kind,
          params: JSON.parse((params[2] as string[])[i]!),
          for_seconds: (params[3] as number[])[i]!,
          clear_seconds: (params[4] as number[])[i]!,
          repeat_seconds: (params[5] as number[])[i]!,
          severity: (params[6] as string[])[i]!,
        });
      });
      return { rows: [] };
    }
    if (sql.includes("FROM alerts.rules r") && sql.includes("WHERE r.enabled")) {
      calls.push("listRules");
      if (failWhen.list) throw new Error("db down");
      return { rows: rules };
    }
    if (sql.includes("FROM alerts.alert_state st")) {
      calls.push("loadStates");
      const serverId = params[0] as string;
      const own = new Set(rules.filter((rule) => rule.server_public_id === serverId).map((rule) => rule.id));
      return { rows: [...states.values()].filter((row) => own.has(row.rule_id as string)) };
    }
    if (sql.includes("FROM alerts.server_mutes")) {
      calls.push("loadMutes");
      return { rows: [...mutes].map(([server_public_id, muted_until_ms]) => ({ server_public_id, muted_until_ms })) };
    }
    if (sql.includes("INSERT INTO alerts.alert_state")) {
      calls.push("upsertStates");
      const [ruleIds, subjects, phases, since, clear, notified, cond] = params as unknown[][];
      (ruleIds as string[]).forEach((ruleId, i) => {
        states.set(`${ruleId}|${(subjects as string[])[i]}`, {
          rule_id: ruleId,
          subject: (subjects as string[])[i],
          phase: (phases as string[])[i],
          since_ms: (since as (number | null)[])[i],
          clear_since_ms: (clear as (number | null)[])[i],
          last_notified_ms: (notified as (number | null)[])[i],
          last_condition: (cond as boolean[])[i],
        });
      });
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO alerts.alert_events")) {
      calls.push("insertEvents");
      if (failWhen.events) throw new Error("events insert failed");
      if (failWhen.eventsFor !== undefined && (params[1] as string[]).some((id) => id.startsWith(`${failWhen.eventsFor}-`))) {
        throw new Error("poison event for one server");
      }
      const [at, ruleIds, kinds, severities, subjects, transitions, summaries] = params as [number, ...unknown[][]];
      insertedIds.length = 0;
      (ruleIds as string[]).forEach((ruleId, i) => {
        insertedIds.push({ id: String(events.length + 1) });
        events.push({
          at,
          ruleId,
          kind: (kinds as string[])[i],
          severity: (severities as string[])[i],
          subject: (subjects as string[])[i],
          transition: (transitions as string[])[i],
          summary: JSON.parse((summaries as string[])[i]!),
        });
      });
      return { rows: [...insertedIds] };
    }
    if (sql.includes("INSERT INTO alerts.outbox")) {
      calls.push("enqueue");
      if (failWhen.enqueue) throw new Error("outbox insert failed");
      (params[0] as string[]).forEach((id) => outbox.push(id));
      return { rows: [] };
    }
    if (sql.includes("DELETE FROM alerts.alert_events")) {
      calls.push("purge");
      return { rows: [{ deleted: 0 }] };
    }
    throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
  };

  const client = {
    on: () => {},
    removeListener: () => {},
    release: () => {},
    query: async (sql: string, params?: unknown[]) => {
      // Under a transaction, a failed statement must undo the ones before it (what ROLLBACK does for real).
      return handle(sql, params);
    },
  };
  const db = {
    query: async (sql: string, params?: unknown[]) => handle(sql, params),
    connect: async () => {
      // A snapshot the fake restores on ROLLBACK, so the atomicity of writeEvaluation is observable.
      const savedStates = new Map(states);
      const savedEvents = events.length;
      const savedOutbox = outbox.length;
      const tx = {
        ...client,
        query: async (sql: string, params?: unknown[]) => {
          if (sql.startsWith("ROLLBACK")) {
            states.clear();
            savedStates.forEach((value, key) => states.set(key, value));
            events.length = savedEvents;
            outbox.length = savedOutbox;
          }
          return handle(sql, params);
        },
      };
      return tx;
    },
  } as unknown as AlertsDb;
  return { db, rules, states, events, calls, mutes, failWhen, log, outbox };
}

const logger = () => {
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const make = (level: string) => (obj: Record<string, unknown> | string, msg?: string) => {
    lines.push({ level, obj: typeof obj === "string" ? {} : obj, msg: typeof obj === "string" ? obj : (msg ?? "") });
  };
  return { logger: { info: make("info"), warn: make("warn"), error: make("error") } as unknown as Logger, lines };
};

function world(ids: string[] = ["alpha"]) {
  const boards = new Map(ids.map((id) => [id, new ObservationBoard()]));
  const directory = new InMemoryServerDirectory<TelemetryScope>(
    ids.map((id) => ({ id, displayName: id, services: { telemetry: { observations: boards.get(id) } } as unknown as TelemetryScope })),
  );
  return { boards, directory };
}

const publishOutage = (board: ObservationBoard, at: number, outage: boolean) => {
  board.recordPollSuccess(at);
  board.publishStatus({ observedAt: at, intervalMs: 5 * SEC, paused: false, session: "S" });
  board.publishPower({ observedAt: at, intervalMs: 5 * SEC, circuits: [{ circuit: 1, status: outage ? "outage" : "ok", fuseTripped: outage }] });
};

describe("AlertEvaluatorWorker.tick", () => {
  let now = T0;
  beforeEach(() => {
    now = T0;
  });

  const make = (fake: ReturnType<typeof fakeDb>, w: ReturnType<typeof world>, l = logger(), deliver?: boolean) =>
    ({ worker: new AlertEvaluatorWorker(fake.db, w.directory, { logger: l.logger, now: () => now, deliver }), ...l });

  it("seeds the presets once per server and only for servers that have observations", async () => {
    const fake = fakeDb();
    const w = world(["alpha", "bravo"]);
    const { worker } = make(fake, w);
    await worker.tick();
    now += 30 * SEC;
    await worker.tick();
    expect(fake.calls.filter((call) => call === "seed")).toHaveLength(2); // once per server, not per tick
    expect(fake.rules.map((rule) => `${rule.server_public_id}:${rule.kind}`).sort()).toEqual([
      "alpha:power_outage", "alpha:server_unreachable", "alpha:stopped_machines",
      "bravo:power_outage", "bravo:server_unreachable", "bravo:stopped_machines",
    ]);
  });

  it("does nothing for a server without a board (no database history): it is not even seeded", async () => {
    const fake = fakeDb();
    const directory = new InMemoryServerDirectory<TelemetryScope>([{ id: "alpha", displayName: "a", services: { telemetry: {} } as unknown as TelemetryScope }]);
    const worker = new AlertEvaluatorWorker(fake.db, directory, { logger: logger().logger, now: () => now });
    await worker.tick();
    expect(fake.calls).not.toContain("seed");
    expect(fake.events).toEqual([]);
  });

  describe("a server reached through an edge agent (ADR-0031)", () => {
    const agentEntry = (id: string, board: ObservationBoard) => ({
      id,
      displayName: id,
      services: { telemetry: { observations: board } } as unknown as TelemetryScope,
      workers: [],
    });

    it("also gets the 'agent offline' preset, and a polled server does not", async () => {
      const fake = fakeDb();
      const directory = new ServerRuntime<TelemetryScope>([agentEntry("alpha", new ObservationBoard()), agentEntry("friend", new ObservationBoard({ agentStartedAt: now }))]);
      await new AlertEvaluatorWorker(fake.db, directory, { logger: logger().logger, now: () => now }).tick();
      const kinds = (id: string) => fake.rules.filter((rule) => rule.server_public_id === id).map((rule) => rule.kind).sort();
      expect(kinds("alpha")).toEqual(["power_outage", "server_unreachable", "stopped_machines"]);
      expect(kinds("friend")).toEqual(["agent_offline", "power_outage", "server_unreachable", "stopped_machines"]);
    });

    it("a server that becomes an agent server later (its enrolment) is seeded again, once, without a restart", async () => {
      const fake = fakeDb();
      const directory = new ServerRuntime<TelemetryScope>([agentEntry("alpha", new ObservationBoard())]);
      const worker = new AlertEvaluatorWorker(fake.db, directory, { logger: logger().logger, now: () => now });
      await worker.tick();
      await worker.tick();
      expect(fake.rules.map((rule) => rule.kind)).not.toContain("agent_offline");
      await directory.replace(agentEntry("alpha", new ObservationBoard({ agentStartedAt: now })));
      await worker.tick();
      await worker.tick();
      expect(fake.rules.filter((rule) => rule.kind === "agent_offline")).toHaveLength(1);
      expect(fake.calls.filter((call) => call === "seed")).toHaveLength(2);
    });

    it("fires agent_offline after two minutes of silence and resolves once the agent is heard again", async () => {
      const fake = fakeDb();
      const board = new ObservationBoard({ agentStartedAt: now });
      const directory = new ServerRuntime<TelemetryScope>([agentEntry("friend", board)]);
      const worker = new AlertEvaluatorWorker(fake.db, directory, { logger: logger().logger, now: () => now });
      board.recordAgentSeen(now);
      await worker.tick();
      now += 100 * SEC;
      await worker.tick();
      expect(fake.events).toEqual([]);
      now += 30 * SEC; // 130 s since the last snapshot
      await worker.tick();
      expect(fake.events).toMatchObject([{ kind: "agent_offline", severity: "critical", subject: "agent", transition: "fired" }]);
      board.recordAgentSeen(now);
      await worker.tick();
      now += 70 * SEC;
      board.recordAgentSeen(now);
      await worker.tick();
      expect(fake.events.map((event) => `${event.kind}:${event.transition}`)).toEqual(["agent_offline:fired", "agent_offline:resolved"]);
    });
  });

  it("records an outage as fired exactly once, persists the state, and resolves it after the clear duration", async () => {
    const fake = fakeDb();
    const w = world();
    const { worker, lines } = make(fake, w);
    await worker.tick(); // seeds; nothing observed yet
    publishOutage(w.boards.get("alpha")!, now, true);
    await worker.tick();
    expect(fake.events).toMatchObject([{ kind: "power_outage", severity: "critical", subject: "circuit:1", transition: "fired", summary: { circuit: 1 }, at: now }]);
    now += 30 * SEC;
    publishOutage(w.boards.get("alpha")!, now, true);
    await worker.tick();
    expect(fake.events).toHaveLength(1); // the same outage is not raised again
    now += 30 * SEC;
    publishOutage(w.boards.get("alpha")!, now, false);
    await worker.tick(); // clearing starts
    now += 61 * SEC;
    publishOutage(w.boards.get("alpha")!, now, false);
    await worker.tick();
    expect(fake.events.map((event) => event.transition)).toEqual(["fired", "resolved"]);
    expect(lines.some((line) => line.msg === "alert event recorded" && line.obj.transition === "fired")).toBe(true);
  });

  it("a restart (a new worker over the same database) does not fire the outage again", async () => {
    const fake = fakeDb();
    const w = world();
    const first = make(fake, w).worker;
    await first.tick();
    publishOutage(w.boards.get("alpha")!, now, true);
    await first.tick();
    expect(fake.events).toHaveLength(1);
    now += 30 * SEC;
    publishOutage(w.boards.get("alpha")!, now, true);
    const second = make(fake, w).worker; // a new process: the in-memory parts are gone, the persisted state stays
    await second.tick();
    expect(fake.events).toHaveLength(1);
  });

  it("a failed write skips the tick with no state change: the next tick records the event (not lost, not doubled)", async () => {
    const fake = fakeDb();
    const w = world();
    const { worker } = make(fake, w);
    await worker.tick();
    publishOutage(w.boards.get("alpha")!, now, true);
    fake.failWhen.events = true;
    await expect(worker.tick()).rejects.toThrow("events insert failed");
    expect(fake.events).toEqual([]);
    expect(fake.states.size).toBe(0); // the state write was rolled back with the event
    fake.failWhen.events = false;
    now += 30 * SEC;
    publishOutage(w.boards.get("alpha")!, now, true);
    await worker.tick();
    expect(fake.events.map((event) => event.transition)).toEqual(["fired"]);
  });

  it("skips a rule whose params cannot be read, logs its code once, and keeps evaluating the others", async () => {
    const fake = fakeDb([
      { id: "bad", server_public_id: "alpha", kind: "stopped_machines", params: { stoppedBelowPercent: "lots" }, for_seconds: 300, clear_seconds: 120, repeat_seconds: 3600, severity: "warning" },
      { id: "worse", server_public_id: "alpha", kind: "not_a_kind", params: {}, for_seconds: 0, clear_seconds: 0, repeat_seconds: 60, severity: "warning" },
      { id: "sev", server_public_id: "alpha", kind: "fuse_trip", params: {}, for_seconds: 0, clear_seconds: 0, repeat_seconds: 60, severity: "apocalyptic" },
    ]);
    const w = world();
    const { worker, lines } = make(fake, w);
    await worker.tick();
    publishOutage(w.boards.get("alpha")!, now, true);
    await worker.tick();
    now += 30 * SEC;
    await worker.tick();
    const warnings = lines.filter((line) => line.obj.code === "ALERT_RULE_UNREADABLE");
    expect(warnings.map((line) => line.obj.ruleId).sort()).toEqual(["bad", "sev", "worse"]); // each once, not every tick
    expect(fake.events.map((event) => event.kind)).toEqual(["power_outage"]); // the readable presets still work
  });

  it("evaluates nothing while the server is muted", async () => {
    const fake = fakeDb();
    const w = world();
    const { worker } = make(fake, w);
    fake.mutes.set("alpha", now + 10 * MIN);
    await worker.tick();
    publishOutage(w.boards.get("alpha")!, now, true);
    await worker.tick();
    expect(fake.events).toEqual([]);
    now += 11 * MIN;
    publishOutage(w.boards.get("alpha")!, now, true);
    await worker.tick();
    expect(fake.events.map((event) => event.transition)).toEqual(["fired"]); // the mute ended
  });

  it("purges expired alert events on the first tick and then once per purge interval", async () => {
    const fake = fakeDb();
    const w = world();
    const { worker } = make(fake, w);
    await worker.tick();
    now += 30 * SEC;
    await worker.tick();
    expect(fake.calls.filter((call) => call === "purge")).toHaveLength(1);
    now += 10 * MIN;
    await worker.tick();
    expect(fake.calls.filter((call) => call === "purge")).toHaveLength(2);
  });

  it("a mute that ends exactly now no longer mutes", async () => {
    const fake = fakeDb();
    const w = world();
    const { worker } = make(fake, w);
    await worker.tick();
    fake.mutes.set("alpha", now);
    publishOutage(w.boards.get("alpha")!, now, true);
    await worker.tick();
    expect(fake.events.map((event) => event.transition)).toEqual(["fired"]);
  });

  it("purges again exactly one purge interval after the last purge, not a moment later", async () => {
    const fake = fakeDb();
    const w = world();
    const { worker } = make(fake, w);
    await worker.tick();
    now += 10 * MIN - 1;
    await worker.tick();
    expect(fake.calls.filter((call) => call === "purge")).toHaveLength(1);
    now += 1;
    await worker.tick();
    expect(fake.calls.filter((call) => call === "purge")).toHaveLength(2);
  });

  it("keeps one evaluator per server across ticks (machine timers survive between ticks)", async () => {
    const stoppedRule = { id: "sm", server_public_id: "alpha", kind: "stopped_machines", params: { stoppedBelowPercent: 5 }, for_seconds: 60, clear_seconds: 60, repeat_seconds: 3600, severity: "warning" };
    const fake = fakeDb([stoppedRule]);
    const w = world();
    const { worker } = make(fake, w);
    const board = w.boards.get("alpha")!;
    const publish = () => {
      board.recordPollSuccess(now);
      board.publishStatus({ observedAt: now, intervalMs: 5 * SEC, paused: false, session: "S" });
      board.publishFactory({ observedAt: now, intervalMs: 30 * SEC, afterResume: false, machines: [{ id: "m1", className: "C", recipe: "Wire", state: "underfed", outputPercent: 0 }], itemRates: new Map() });
    };
    publish();
    await worker.tick();
    now += 30 * SEC;
    publish();
    await worker.tick();
    expect(fake.events).toEqual([]);
    now += 31 * SEC;
    publish();
    await worker.tick();
    expect(fake.events.map((event) => `${event.subject}:${event.transition}`)).toEqual(["group:fired"]);
  });

  it("a rule that became unreadable, was fixed and broke again is logged again", async () => {
    const bad = { id: "bad", server_public_id: "alpha", kind: "stopped_machines", params: { stoppedBelowPercent: "lots" } as unknown, for_seconds: 300, clear_seconds: 120, repeat_seconds: 3600, severity: "warning" };
    const fake = fakeDb([bad]);
    const w = world();
    const { worker, lines } = make(fake, w);
    const warnings = () => lines.filter((line) => line.obj.code === "ALERT_RULE_UNREADABLE").length;
    await worker.tick();
    expect(warnings()).toBe(1);
    bad.params = { stoppedBelowPercent: 5 };
    await worker.tick();
    bad.params = { stoppedBelowPercent: "lots" };
    await worker.tick();
    expect(warnings()).toBe(2);
  });

  it("a failed write on the tick that ends a suppressed stretch keeps the resume cleanup for the retry", async () => {
    const outageRule = { id: "po", server_public_id: "alpha", kind: "power_outage", params: {}, for_seconds: 0, clear_seconds: 20, repeat_seconds: 3600, severity: "critical" };
    const fake = fakeDb([outageRule]);
    const w = world();
    const { worker } = make(fake, w);
    const board = w.boards.get("alpha")!;
    const publish = (paused: boolean, circuits: { circuit: number; status: "ok" | "outage"; fuseTripped: boolean }[]) => {
      board.recordPollSuccess(now);
      board.publishStatus({ observedAt: now, intervalMs: 5 * SEC, paused, session: "S" });
      board.publishPower({ observedAt: now, intervalMs: 5 * SEC, circuits });
    };
    const out = { circuit: 1, status: "outage" as const, fuseTripped: true };
    const fine = { circuit: 1, status: "ok" as const, fuseTripped: false };
    publish(false, [out]);
    await worker.tick(); // fired
    now += 10 * SEC;
    publish(false, [fine]);
    await worker.tick(); // a clear run starts
    now += 5 * SEC;
    publish(true, [fine]);
    await worker.tick(); // paused: suppressed
    now += 15 * SEC;
    publish(false, [fine, { circuit: 2, status: "outage", fuseTripped: true }]);
    fake.failWhen.events = true;
    await expect(worker.tick()).rejects.toThrow(); // the resume tick's write fails and rolls back
    fake.failWhen.events = false;
    now += 5 * SEC;
    publish(false, [fine, { circuit: 2, status: "outage", fuseTripped: true }]);
    await worker.tick(); // the gap must not count towards the clear: circuit 1 is NOT resolved yet
    expect(fake.events.map((event) => `${event.subject}:${event.transition}`)).toEqual(["circuit:1:fired", "circuit:2:fired"]);
  });

  it("one server's failing write does not starve the servers after it: they are evaluated, the purge runs, then the tick throws", async () => {
    const fake = fakeDb();
    const w = world(["alpha", "bravo"]);
    const { worker } = make(fake, w);
    await worker.tick();
    publishOutage(w.boards.get("alpha")!, now, true);
    publishOutage(w.boards.get("bravo")!, now, true);
    fake.failWhen.eventsFor = "alpha"; // alpha is first in the list and its event insert fails
    now += 30 * SEC;
    publishOutage(w.boards.get("alpha")!, now, true);
    publishOutage(w.boards.get("bravo")!, now, true);
    const purgesBefore = fake.calls.filter((call) => call === "purge").length;
    await expect(worker.tick()).rejects.toThrow("poison event for one server");
    expect(fake.events.map((event) => event.ruleId)).toEqual(["bravo-power_outage"]); // bravo still got its alert
    now += 10 * MIN + SEC;
    publishOutage(w.boards.get("alpha")!, now, true);
    publishOutage(w.boards.get("bravo")!, now, true);
    await expect(worker.tick()).rejects.toThrow(); // still failing for alpha, and the purge ran on the way
    expect(fake.calls.filter((call) => call === "purge").length).toBeGreaterThan(purgesBefore);
    fake.failWhen.eventsFor = undefined;
    now += 30 * SEC;
    publishOutage(w.boards.get("alpha")!, now, true);
    await worker.tick();
    expect(fake.events.map((event) => event.ruleId)).toEqual(["bravo-power_outage", "alpha-power_outage"]); // alpha recovers, once
  });

  describe("the delivery kill switch (ALERT_DELIVERY)", () => {
    it("OFF (the default): events are recorded but NO outbox row is ever queued", async () => {
      const fake = fakeDb();
      const w = world();
      for (const worker of [make(fake, w).worker, make(fake, w, logger(), false).worker]) {
        await worker.tick();
      }
      publishOutage(w.boards.get("alpha")!, now, true);
      await make(fake, w).worker.tick();
      expect(fake.events.map((event) => event.transition)).toEqual(["fired"]);
      expect(fake.calls).not.toContain("enqueue");
      expect(fake.outbox).toEqual([]);
    });

    it("ON: each new event is queued in the same transaction, once", async () => {
      const fake = fakeDb();
      const w = world();
      const { worker } = make(fake, w, logger(), true);
      await worker.tick();
      publishOutage(w.boards.get("alpha")!, now, true);
      await worker.tick();
      expect(fake.events).toHaveLength(1);
      expect(fake.calls.filter((call) => call === "enqueue")).toHaveLength(1);
      expect(fake.outbox).toEqual(["1"]);
      now += 30 * SEC;
      publishOutage(w.boards.get("alpha")!, now, true);
      await worker.tick(); // nothing new happened: nothing queued
      expect(fake.outbox).toEqual(["1"]);
    });

    it("switching it on later sends only transitions that happen AFTER that (earlier events were never queued)", async () => {
      const fake = fakeDb();
      const w = world();
      const off = make(fake, w).worker;
      await off.tick();
      publishOutage(w.boards.get("alpha")!, now, true);
      await off.tick(); // fired while off
      expect(fake.outbox).toEqual([]);
      const on = make(fake, w, logger(), true).worker; // the operator restarts with the switch on
      now += 30 * SEC;
      publishOutage(w.boards.get("alpha")!, now, true);
      await on.tick(); // still down: no transition, so nothing to send
      expect(fake.outbox).toEqual([]);
      now += 30 * SEC;
      publishOutage(w.boards.get("alpha")!, now, false);
      await on.tick();
      now += 61 * SEC;
      publishOutage(w.boards.get("alpha")!, now, false);
      await on.tick(); // resolved after the switch: this one is queued
      expect(fake.events.map((event) => event.transition)).toEqual(["fired", "resolved"]);
      expect(fake.outbox).toEqual(["2"]);
    });

    it("the queue write is ATOMIC with the event: if it fails, the event and the state are rolled back too, and nothing is lost", async () => {
      const fake = fakeDb();
      const w = world();
      const { worker } = make(fake, w, logger(), true);
      await worker.tick();
      publishOutage(w.boards.get("alpha")!, now, true);
      fake.failWhen.enqueue = true;
      await expect(worker.tick()).rejects.toThrow("outbox insert failed");
      expect(fake.events).toEqual([]);
      expect(fake.states.size).toBe(0);
      expect(fake.outbox).toEqual([]);
      fake.failWhen.enqueue = false;
      now += 30 * SEC;
      publishOutage(w.boards.get("alpha")!, now, true);
      await worker.tick();
      expect(fake.events.map((event) => event.transition)).toEqual(["fired"]);
      expect(fake.outbox).toEqual(["1"]);
    });
  });

  it("evaluates each server on its own board", async () => {
    const fake = fakeDb();
    const w = world(["alpha", "bravo"]);
    const { worker } = make(fake, w);
    await worker.tick();
    publishOutage(w.boards.get("bravo")!, now, true);
    publishOutage(w.boards.get("alpha")!, now, false);
    await worker.tick();
    expect(fake.events.map((event) => event.ruleId)).toEqual(["bravo-power_outage"]);
  });
});

describe("AlertEvaluatorWorker loop", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("ticks every 30 s, survives a failing database (one warning, one recovery line), and stops cleanly", async () => {
    const fake = fakeDb();
    const w = world();
    const l = logger();
    const worker = new AlertEvaluatorWorker(fake.db, w.directory, { logger: l.logger, tickMs: 30_000 });
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.calls.filter((call) => call === "listRules")).toHaveLength(1);
    fake.failWhen.list = true;
    await vi.advanceTimersByTimeAsync(30_000 * 3);
    expect(l.lines.filter((line) => line.level === "warn" && /failed/.test(line.msg))).toHaveLength(1); // once, not per tick
    fake.failWhen.list = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(l.lines.some((line) => line.msg === "alert evaluation recovered")).toBe(true);
    await worker.stop();
    const before = fake.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fake.calls.length).toBe(before); // stopped for good
    worker.start(); // a stopped worker is not restartable
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.calls.length).toBe(before);
  });
});
