import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { codeEdges, compareEdges, componentOf, parseWorkspace } from "./architecture-drift.mjs";

const DSL = `
api = container "Backend API" {
    root = component "Composition root" "Wires" "app.ts, server.ts"
    platform = component "platform" "x" "TypeScript" {
        properties {
            "code" "platform"
        }
    }
    telemetry = component "telemetry" "x" "TypeScript" {
        properties {
            "code" "modules/telemetry"
        }
    }
    gameserver = component "gameserver" "x" "TypeScript" {
        properties {
            "code" "modules/gameserver"
        }
    }
}
satis.api.root -> satis.api.telemetry "Wires" "call" "wiring"
satis.api.telemetry -> satis.api.gameserver "Reads" "call"
satis.api.telemetry -> satis.api.platform "Uses" "call" "platform-use"
satis.spa -> satis.api.telemetry "Reads" "HTTPS"
satis.api -> game "Reads" "HTTPS"
`;

test("parseWorkspace keeps only edges between Backend API components, keyed by code", () => {
  const { codes, edges, unresolved } = parseWorkspace(DSL);
  assert.equal(codes.get("root"), "root");
  assert.equal(codes.get("telemetry"), "modules/telemetry");
  assert.deepEqual([...edges].sort(), [
    "modules/telemetry->modules/gameserver",
    "modules/telemetry->platform",
    "root->modules/telemetry",
  ]);
  assert.deepEqual(unresolved, []);
});

test("parseWorkspace reports a relationship to a component with no code property", () => {
  const { unresolved } = parseWorkspace(`${DSL}\nsatis.api.telemetry -> satis.api.ghost "Uses" "call"`);
  assert.deepEqual(unresolved, ["satis.api.telemetry -> satis.api.ghost"]);
});

test("componentOf maps backend files to model components", () => {
  assert.equal(componentOf("backend/src/modules/telemetry/services/x.ts"), "modules/telemetry");
  assert.equal(componentOf("backend/src/platform/errors.ts"), "platform");
  assert.equal(componentOf("backend/src/server.ts"), "root");
  assert.equal(componentOf("backend\\src\\app.ts"), "root");
  assert.equal(componentOf("backend/src/stray.ts"), null);
  assert.equal(componentOf("backend/src/modules/lonely.ts"), null);
});

const mod = (source, ...deps) => ({
  source,
  dependencies: deps.map((d) => (typeof d === "string" ? { module: "./x.js", resolved: d } : d)),
});

test("codeEdges collapses file imports to component edges and ignores same-component and external ones", () => {
  const { edges, problems } = codeEdges([
    mod("backend/src/modules/telemetry/a.ts", "backend/src/modules/telemetry/b.ts", "backend/src/modules/gameserver/index.ts"),
    mod("backend/src/modules/gameserver/index.ts", "backend/src/platform/errors.ts", { module: "zod", resolved: "node_modules/zod/index.js" }),
    mod("net", "node:fs"),
  ]);
  assert.deepEqual([...edges].sort(), ["modules/gameserver->platform", "modules/telemetry->modules/gameserver"]);
  assert.deepEqual(problems, []);
});

test("codeEdges flags unresolved relative imports and files outside the model, not package subpaths", () => {
  const { problems } = codeEdges([
    mod("backend/src/server.ts", { module: "dotenv/config", couldNotResolve: true }, { module: "./gone.js", couldNotResolve: true }),
    mod("backend/src/stray.ts"),
  ]);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /could not resolve "\.\/gone\.js"/);
  assert.match(problems[1], /stray\.ts belongs to no modelled component/);
});

test("compareEdges reports unknown and missing edges", () => {
  const modelled = new Set(["a->b", "a->c"]);
  const imported = new Set(["a->b", "b->c"]);
  assert.deepEqual(compareEdges(modelled, imported), [
    "unknown edge (imported in code, not in workspace.dsl): b->c",
    "missing edge (in workspace.dsl, no import backs it): a->c",
  ]);
  assert.deepEqual(compareEdges(imported, imported), []);
});

test("the committed workspace.dsl gives every backend component a code mapping and the root edges", () => {
  const { codes, edges } = parseWorkspace(readFileSync("docs-vault/workspace.dsl", "utf8"));
  assert.deepEqual([...codes.values()].sort(), [
    "modules/gameserver",
    "modules/identity",
    "modules/servers",
    "modules/settings",
    "modules/telemetry",
    "platform",
    "root",
  ]);
  assert.ok(edges.has("root->platform"));
  assert.ok(edges.has("modules/telemetry->modules/gameserver"));
});
