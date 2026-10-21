import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { InMemoryServerDirectory, ServerRuntime } from "../../servers/index.js";
import type { TelemetryScope } from "../../telemetry/index.js";
import { ObservationBoard } from "../../telemetry/services/observationBoard.js";
import { AlertEvaluatorWorker, EVENT_QUOTA_WINDOW_MS, MAX_ALERT_EVENTS_PER_SERVER_PER_HOUR, type AlertsDb } from "./alertEvaluatorWorker.js";
import { RULE_KINDS } from "./rules.js";
import { createMetricsAggregator, type MetricsSink } from "../../../platform/metrics/index.js";

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
    if (sql.includes("DELETE FROM alerts.alert_state st")) {
      calls.push("deleteStates");
      const [ruleIds, subjects] = params as string[][];
      ruleIds!.forEach((ruleId, i) => {
        const key = `${ruleId}|${subjects![i]}`;
        if (states.get(key)?.phase === "ok") states.delete(key);
      });
      return { rows: [] };
    }
    if (sql.includes("SELECT count(*)::int AS count") && sql.includes("FROM alerts.alert_events e")) {
      // #515's hourly cap: not in `calls`, so the existing call-order assertions stay as they were.
      const [serverId, sinceMs] = params as [string, number];
      const own = new Set(rules.filter((rule) => rule.server_public_id === serverId).map((rule) => rule.id));
      return { rows: [{ count: events.filter((event) => own.has(event.ruleId as string) && (event.at as number) >= sinceMs).length }] };
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

describe("AlertEvaluatorWorker metrics (ADR-0037 build step 3, fake clock)", () => {
  let now = T0;
  beforeEach(() => {
    now = T0;
  });

  const make = (fake: ReturnType<typeof fakeDb>, w: ReturnType<typeof world>, metrics: MetricsSink, l = logger()) => ({
    worker: new AlertEvaluatorWorker(fake.db, w.directory, { logger: l.logger, now: () => now, metrics }),
    ...l,
  });
  const fireLags = (metrics: ReturnType<typeof createMetricsAggregator>) =>
    metrics
      .drain()
      .filter((delta) => delta.metric === "satis.alerts.fire.lag")
      .map((delta) => ({ kind: delta.labels.kind, count: delta.count, sum: delta.sum }));

  it("records each tick's evaluation duration, with no labels, measured on the clock", async () => {
    const fake = fakeDb();
    const metrics = createMetricsAggregator(() => now);
    const { worker } = make(fake, world(), metrics);
    const query = fake.db.query.bind(fake.db);
    fake.db.query = (async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM alerts.rules r")) now += 120; // the database takes 120 ms to list the rules
      return query(sql, params);
    }) as typeof fake.db.query;
    await worker.tick();
    expect(metrics.drain().filter((d) => d.metric === "satis.alerts.evaluation.duration")).toEqual([
      expect.objectContaining({ labels: {}, count: 1, sum: 120 }),
    ]);
  });

  it("a failed tick still records its duration, and still throws for the loop to log", async () => {
    const fake = fakeDb();
    const metrics = createMetricsAggregator(() => now);
    const { worker } = make(fake, world(), metrics);
    fake.failWhen.list = true;
    await expect(worker.tick()).rejects.toThrow();
    expect(metrics.drain().filter((d) => d.metric === "satis.alerts.evaluation.duration")).toHaveLength(1);
  });

  it("records the fire lag, by kind, as the event time minus the reading that triggered it", async () => {
    const fake = fakeDb();
    const w = world();
    const metrics = createMetricsAggregator(() => now);
    const { worker } = make(fake, w, metrics);
    await worker.tick(); // seeds
    publishOutage(w.boards.get("alpha")!, now - 4 * SEC, true); // the poll's reading is 4 s old when the engine runs
    await worker.tick();
    expect(fake.events.map((event) => `${event.kind}:${event.transition}`)).toEqual(["power_outage:fired"]);
    expect(fireLags(metrics)).toEqual([{ kind: "power_outage", count: 1, sum: 4 * SEC }]);
  });

  it("records no fire lag for a renotify or a resolve, only for a fire", async () => {
    const fake = fakeDb();
    const w = world();
    const metrics = createMetricsAggregator(() => now);
    const { worker } = make(fake, w, metrics);
    await worker.tick();
    publishOutage(w.boards.get("alpha")!, now, true);
    await worker.tick();
    metrics.drain();
    for (let i = 0; i < 4; i++) {
      now += 60 * SEC;
      publishOutage(w.boards.get("alpha")!, now, false);
      await worker.tick();
    }
    expect(fake.events.some((event) => event.transition === "resolved")).toBe(true);
    expect(fireLags(metrics)).toEqual([]);
  });

  it("records no fire lag for a fire that was not stored (a failed write): it is recorded when the retry stores it", async () => {
    const fake = fakeDb();
    const w = world();
    const metrics = createMetricsAggregator(() => now);
    const { worker } = make(fake, w, metrics);
    await worker.tick();
    publishOutage(w.boards.get("alpha")!, now - 1 * SEC, true);
    fake.failWhen.events = true;
    await expect(worker.tick()).rejects.toThrow();
    expect(fireLags(metrics)).toEqual([]);
    fake.failWhen.events = false;
    now += 30 * SEC;
    publishOutage(w.boards.get("alpha")!, now - 2 * SEC, true);
    await worker.tick();
    expect(fireLags(metrics)).toContainEqual({ kind: "power_outage", count: 1, sum: 2 * SEC });
  });

  it("records no fire lag for server_unreachable: it fires on a timer, with no reading to measure from", async () => {
    const fake = fakeDb();
    const w = world();
    const metrics = createMetricsAggregator(() => now);
    const { worker } = make(fake, w, metrics);
    await worker.tick();
    for (let i = 0; i < 6; i++) {
      w.boards.get("alpha")!.recordPollFailure(now);
      await worker.tick();
      now += 30 * SEC;
    }
    expect(fake.events.map((event) => `${event.kind}:${event.transition}`)).toEqual(["server_unreachable:fired"]);
    expect(fireLags(metrics)).toEqual([]);
  });

  it("every rule kind is a value the registry accepts for the kind label", () => {
    const metrics = createMetricsAggregator(() => now);
    for (const kind of RULE_KINDS) {
      expect(() => metrics.recordHistogram("satis.alerts.fire.lag", { kind }, 1), kind).not.toThrow();
    }
  });

  it("a metrics sink that throws never reaches the engine: the events are stored and it is logged once per metric", async () => {
    const fake = fakeDb();
    const w = world();
    const throwing: MetricsSink = {
      recordHistogram() {
        throw new Error("metrics broken");
      },
      recordCounter() {
        throw new Error("metrics broken");
      },
    };
    const { worker, lines } = make(fake, w, throwing);
    await worker.tick();
    publishOutage(w.boards.get("alpha")!, now, true);
    await expect(worker.tick()).resolves.toBeUndefined();
    await worker.tick();
    expect(fake.events.map((event) => event.kind)).toEqual(["power_outage"]);
    expect(lines.filter((line) => line.msg === "failed to record a metric; dropping it").map((line) => line.obj.metric).sort()).toEqual([
      "satis.alerts.evaluation.duration",
      "satis.alerts.fire.lag",
    ]);
  });
});

describe("#515: alert events per server per hour are capped (ADR-0045 M12)", () => {
  /** Every circuit in `ids` in outage (or not), for one server's board. */
  const publishCircuits = (board: ObservationBoard, at: number, outage: boolean, ids: number[]) => {
    board.recordPollSuccess(at);
    board.publishStatus({ observedAt: at, intervalMs: 5 * SEC, paused: false, session: "S" });
    board.publishPower({ observedAt: at, intervalMs: 5 * SEC, circuits: ids.map((circuit) => ({ circuit, status: outage ? "outage" : "ok", fuseTripped: false })) });
  };
  const circuits = Array.from({ length: 64 }, (_, i) => i + 1);

  it("a flooding server stops at the cap; another server's alert in the same tick is still logged and queued", async () => {
    let now = T0;
    const fake = fakeDb();
    const w = world(["alpha", "bravo"]);
    const l = logger();
    const metrics = createMetricsAggregator(() => 0);
    const worker = new AlertEvaluatorWorker(fake.db, w.directory, { logger: l.logger, now: () => now, deliver: true, metrics });
    const alpha = w.boards.get("alpha")!;
    const bravo = w.boards.get("bravo")!;
    // alpha flaps 64 circuits: 3 ticks in outage (fires), 3 ticks ok (resolves after the 60 s clear), and again.
    for (let tick = 0; tick < 12; tick++) {
      publishCircuits(alpha, now, Math.floor(tick / 3) % 2 === 0, circuits);
      publishOutage(bravo, now, tick === 10);
      await worker.tick();
      now += 30 * SEC;
    }
    const of = (server: string) => fake.events.filter((event) => (event.ruleId as string).startsWith(`${server}-`));
    expect(of("alpha")).toHaveLength(MAX_ALERT_EVENTS_PER_SERVER_PER_HOUR);
    expect(of("bravo").map((event) => event.transition)).toEqual(["fired"]);
    // bravo's event was queued for delivery like any other (the outbox got every stored event).
    expect(fake.outbox).toHaveLength(MAX_ALERT_EVENTS_PER_SERVER_PER_HOUR + 1);
    const dropped = metrics.drain().filter((delta) => delta.metric === "satis.alerts.events_dropped");
    expect(dropped.map((delta) => delta.labels)).toEqual([{ server: "alpha" }]);
    expect(dropped[0]!.sum).toBeGreaterThan(0);
    // One warning for alpha in the hour, with ids and counts only.
    const warnings = l.lines.filter((line) => line.obj.code === "ALERT_EVENT_QUOTA_EXCEEDED");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.obj).toMatchObject({ serverId: "alpha" });
  });

  it("the cap is a sliding hour counted from the alert log: room comes back as old events age out", async () => {
    let now = T0;
    const fake = fakeDb();
    const w = world(["alpha"]);
    const worker = new AlertEvaluatorWorker(fake.db, w.directory, { logger: logger().logger, now: () => now });
    const alpha = w.boards.get("alpha")!;
    const flap = async (ticks: number) => {
      for (let tick = 0; tick < ticks; tick++) {
        publishCircuits(alpha, now, Math.floor(tick / 3) % 2 === 0, circuits);
        await worker.tick();
        now += 30 * SEC;
      }
    };
    await flap(12);
    expect(fake.events).toHaveLength(MAX_ALERT_EVENTS_PER_SERVER_PER_HOUR);
    await flap(6); // still within the hour of the first events: nothing more
    expect(fake.events).toHaveLength(MAX_ALERT_EVENTS_PER_SERVER_PER_HOUR);
    now += EVENT_QUOTA_WINDOW_MS;
    await flap(6);
    expect(fake.events.length).toBeGreaterThan(MAX_ALERT_EVENTS_PER_SERVER_PER_HOUR);
  });
});
