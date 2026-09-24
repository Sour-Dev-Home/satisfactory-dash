import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  codeEdges,
  compareComponents,
  compareEdges,
  componentOf,
  parseWorkspace,
  typeOnlyReExports,
  vacuityProblems,
} from "./architecture-drift.mjs";

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

test("parseWorkspace ignores commented-out relationships and declarations, and tolerates CRLF", () => {
  const dsl = `${DSL}
// satis.api.gameserver -> satis.api.platform "Uses" "call"
# satis.api.gameserver -> satis.api.telemetry "Uses" "call"
/*
satis.api.gameserver -> satis.api.root "Uses" "call"
ghost = component "ghost" "x" "TS" {
    properties {
        "code" "modules/ghost"
    }
}
*/`.replaceAll("\n", "\r\n");
  const { codes, edges } = parseWorkspace(dsl);
  assert.equal(edges.size, 3);
  assert.ok(![...codes.values()].includes("modules/ghost"));
});

test("parseWorkspace reports duplicate component ids and duplicate code mappings", () => {
  const dup = `${DSL}
    telemetry2 = component "again" "x" "TypeScript" {
        properties {
            "code" "modules/telemetry"
        }
    }`;
  assert.deepEqual(parseWorkspace(dup).duplicates, ["code \"modules/telemetry\" is mapped by more than one component"]);
  assert.equal(parseWorkspace(dup.replace("telemetry2", "telemetry")).duplicates.length, 1);
  assert.deepEqual(parseWorkspace(DSL).duplicates, []);
});

test("typeOnlyReExports finds export type ... from (which dependency-cruiser misses)", () => {
  const text = [
    'export type { A } from "../identity/index.js";',
    'export type * from "./b.js";',
    'export type * as NS from "../c.js";',
    'export type { Z } from "zod";',
    'export { type Q } from "../q.js";',
    "export type X = string;",
  ].join("\n");
  assert.deepEqual(typeOnlyReExports(text), ["../identity/index.js", "./b.js", "../c.js"]);
});

test("compareComponents flags a code component missing from the model and the reverse", () => {
  assert.deepEqual(compareComponents(["a", "b"].values(), new Set(["a", "b"])), []);
  assert.deepEqual(compareComponents(["a"].values(), new Set(["a", "modules/new"])), [
    "component in code, not in workspace.dsl: modules/new",
  ]);
  assert.deepEqual(compareComponents(["a", "gone"].values(), new Set(["a"])), [
    "component in workspace.dsl, no source files in code: gone",
  ]);
});

test("vacuityProblems passes real input and fails every kind of emptiness", () => {
  const good = { componentCount: 7, modelEdgeCount: 15, codeEdgeCount: 15, cruisedSources: ["backend/src/app.ts"] };
  assert.deepEqual(vacuityProblems(good), []);
  assert.equal(vacuityProblems({ ...good, componentCount: 0 }).length, 1);
  assert.equal(vacuityProblems({ ...good, modelEdgeCount: 0 }).length, 1);
  assert.equal(vacuityProblems({ ...good, codeEdgeCount: 0 }).length, 1);
  assert.equal(vacuityProblems({ ...good, cruisedSources: [] }).length, 1);
  assert.equal(vacuityProblems({ ...good, cruisedSources: ["node_modules/zod/index.js"] }).length, 1);
  assert.equal(vacuityProblems({ componentCount: 0, modelEdgeCount: 0, codeEdgeCount: 0, cruisedSources: [] }).length, 4);
});

test("a DSL whose relationships sit in a nested block yields no edges, which the vacuity check then catches", () => {
  const nested = `
api = container "Backend API" {
    telemetry = component "telemetry" "x" "TypeScript" {
        properties {
            "code" "modules/telemetry"
        }
    }
}
`;
  const { codes, edges } = parseWorkspace(nested);
  assert.equal(edges.size, 0);
  assert.ok(vacuityProblems({ componentCount: codes.size, modelEdgeCount: edges.size, codeEdgeCount: 3, cruisedSources: ["backend/src/app.ts"] }).length >= 1);
});

test("a later element's code property is not given to the previous component", () => {
  const dsl = `
telemetry = component "telemetry" "x" "TypeScript" {
    properties {
        "code" "modules/telemetry"
    }
}
other = container "Other" {
    properties {
        "code" "modules/other"
    }
}
extra = component "extra" "no block" "TypeScript"
container "Anonymous" {
    properties {
        "code" "modules/anon"
    }
}
`;
  const { codes, duplicates } = parseWorkspace(dsl);
  assert.deepEqual([...codes], [["telemetry", "modules/telemetry"]]);
  assert.deepEqual(duplicates, []);
});
