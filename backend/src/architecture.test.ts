import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { ownValue } from "@satisfactory-dash/shared";

/**
 * ADR-0014 step 1: the module boundaries are enforced by this fitness function, not by
 * convention. It reads every non-test source file, extracts its import specifiers and
 * checks the dependency rules below. A new edge between modules is a design change: ask
 * the architect, then update ALLOWED_MODULE_EDGES here.
 *
 *   1. platform/ imports no module.
 *   2. A module imports another module only through that module's index.ts.
 *   3. (Retired, ADR-0066 build PR 7: it bounded the gameserver module, which is gone.)
 *   4. Only the listed module-to-module edges exist.
 *   5. Only app.ts / server.ts (the composition root) import everything, and nothing
 *      imports them.
 *   6. Backend production code imports only the bare "@satisfactory-dash/shared". Never
 *      "/browser" (it turns off zod's runtime compilation for the whole process; the
 *      frontend imports it, ADR-0016) and never "/fixtures" (tests only: test files are
 *      not scanned here) or a deep path into the package.
 *   7. (Retired, ADR-0066 build PR 7: it bounded the game-adapter package, which is gone.)
 *   8. The backend never calls a game server directly (ADR-0066): no file imports the retired
 *      "@satisfactory-dash/game-adapter" package, backend/package.json lists it nowhere, and it does not
 *      resolve. Game data reaches the backend only through the mod's /agent/v1 push (modules/agents).
 */
const ALLOWED_MODULE_EDGES: Record<string, string[]> = {
  // ADR-0056 section 3: the operator gate lives in identity and servers uses it (identity imports nothing from servers).
  servers: ["identity"],
  identity: [],
  // ADR-0056 PR 3: the operator metrics page reads metrics.series_hourly and uses identity's operator gate.
  // ADR-0056 PR 4: its alert-quality section is composed from the alerts module's `alertQualitySummary` (ADR-0056 build
  // order, row 4). alerts never imports metrics, so this adds no cycle.
  metrics: ["identity", "alerts"],
  // ADR-0048 amendment (#349) PR 4: the bottlenecks route reads the conveyors world layer through the map module's index.
  // map never imports telemetry, so this adds no cycle.
  telemetry: ["servers", "map"],
  settings: ["servers"],
  // ADR-0027 PR 5: the alert engine reads the pollers' readings (telemetry) and the server list (servers), through
  // their index.ts, and owns the `alerts` schema.
  alerts: ["telemetry", "servers"],
  // ADR-0031 PR 5a: the edge agent's enrolment and snapshot ingest hand each snapshot to the telemetry services of an
  // agent-backed server and switch a server's connection kind (servers), both through their index.ts; it owns the
  // `agents` schema.
  agents: ["telemetry", "servers"],
  // ADR-0038 M3 (#353): the map's world layers and mapLive. Resolves servers (servers) — never
  // telemetry: mapLive from an agent-backed server reaches this module's MapLiveStore through a
  // narrow port telemetry itself defines (AgentIngestDeps.mapLive), satisfied structurally, not
  // through an import edge. Owns the `map` schema.
  map: ["servers"],
};

/** The retired game-adapter package (ADR-0066 build PR 7): any specifier of it, and any subpath of it. */
const GAME_ADAPTER = /^@satisfactory-dash\/game-adapter(\/|$)/;
const GAME_ADAPTER_NAME = "@satisfactory-dash/game-adapter";
/** The only bare imports servers may use, besides platform/ and shared (per the architect). */
const SERVERS_ALLOWED_PACKAGES = [/^node:/, /^express$/, /^zod$/, /^@satisfactory-dash\/shared$/];

/** Any subpath of the shared package: "@satisfactory-dash/shared/browser", "/fixtures", "/src/..." */
const SHARED_SUBPATH = /^@satisfactory-dash\/shared\//;

/** Every import specifier in a source file: static, re-export, side-effect, dynamic and require(). */
export function importSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    // import("x"), import (`x`), import("x", { with: ... }), require("x"), import x = require("x")
    /\b(?:import|require)\s*\(\s*["'`]([^"'`]+)["'`]\s*[,)]/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/** "modules/telemetry/routes/status.ts" -> "telemetry"; anything else -> null. A folder
 *  import ("../telemetry" resolves to telemetry/index under moduleResolution "bundler")
 *  has no trailing slash, so "modules/telemetry" counts too. */
function moduleOf(file: string): string | null {
  return /^modules\/([^/]+)(?:\/|$)/.exec(file)?.[1] ?? null;
}

/** Resolves a relative specifier to a src-relative path without extension, or null for a package. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  // A trailing slash ("../telemetry/") is a folder import too; join keeps it, so drop it.
  return path.posix.join(path.posix.dirname(fromFile), specifier).replace(/\.(js|ts)$/, "").replace(/\/$/, "");
}

/** Checks the rules against a map of src-relative path -> source. Returns readable violations. */
export function findViolations(files: Map<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, source] of files) {
    const fromModule = moduleOf(file);
    const inPlatform = file.startsWith("platform/");
    // Only the composition root is exempt from the rules, so it is exactly these two files.
    const isRoot = file === "app.ts" || file === "server.ts";
    if (!fromModule && !inPlatform && !isRoot) {
      violations.push(`${file}: rule 5: source files must live in platform/, modules/, or be app.ts / server.ts`);
    }
    for (const specifier of importSpecifiers(source)) {
      const target = resolveRelative(file, specifier);
      const fail = (rule: string) => violations.push(`${file} imports "${specifier}": ${rule}`);

      if (target === null) {
        if (SHARED_SUBPATH.test(specifier)) {
          fail('rule 6: import only the bare "@satisfactory-dash/shared" (not /browser, /fixtures or a deep path)');
        }
        if (GAME_ADAPTER.test(specifier)) {
          fail("rule 8: the game-adapter package is retired (ADR-0066); game data arrives only through the mod's /agent/v1 push");
        }
        if (fromModule === "servers" && !SERVERS_ALLOWED_PACKAGES.some((p) => p.test(specifier))) {
          fail("rule 4: servers may import only platform/, shared and express types");
        }
        continue;
      }

      const toModule = moduleOf(target);
      if (!isRoot && /^(app|server)$/.test(target)) {
        fail("rule 5: only the composition root is imported by nothing, and imports everything");
      }
      if (inPlatform && toModule) {
        fail("rule 1: platform/ must not import a module");
      }
      if (fromModule && toModule && fromModule !== toModule) {
        if (target !== `modules/${toModule}/index` && target !== `modules/${toModule}`) {
          fail(`rule 2: import module "${toModule}" only through its index.ts`);
        }
        if (!(ownValue(ALLOWED_MODULE_EDGES, fromModule) ?? []).includes(toModule)) {
          fail(`rule 4: edge ${fromModule} -> ${toModule} is not allowed`);
        }
      }
    }
  }
  return violations;
}

function readSources(): Map<string, string> {
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  const files = new Map<string, string>();
  for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      continue;
    }
    const full = path.join(entry.parentPath, entry.name);
    const relative = path.relative(srcDir, full).split(path.sep).join("/");
    files.set(relative, readFileSync(full, "utf8"));
  }
  return files;
}

describe("architecture (ADR-0014 dependency rules)", () => {
  it("the real source tree obeys every rule", () => {
    const files = readSources();
    expect(files.size).toBeGreaterThan(20); // guards against the scan silently finding nothing
    expect(findViolations(files)).toEqual([]);
  });

  it("only app.ts and server.ts sit at the top of src/ (rule 5: they are exempt, so nothing else may be)", () => {
    const rootFiles = [...readSources().keys()].filter((f) => !f.includes("/")).sort();
    expect(rootFiles).toEqual(["app.ts", "server.ts"]);
  });

  // The checker itself must be able to fail: each case is a deliberate violation.
  const bad: [string, string, string, RegExp][] = [
    ["platform importing a module", "platform/x.ts", `import { a } from "../modules/servers/index.js";`, /rule 1/],
    ["a deep import into another module", "modules/telemetry/x.ts", `import { a } from "../servers/serverRuntime.js";`, /rule 2/],
    ["an edge that is not allowed", "modules/servers/x.ts", `import { a } from "../telemetry/index.js";`, /rule 4/],
    ["a module importing the composition root", "modules/identity/x.ts", `import { app } from "../../app.js";`, /rule 5/],
    ["servers importing an unlisted package", "modules/servers/x.ts", `import cors from "cors";`, /rule 4/],
    ["a multi-line import", "platform/x.ts", `import {\n  a,\n  b,\n} from "../modules/identity/index.js";`, /rule 1/],
    ["a folder import into a module (platform)", "platform/x.ts", `import { a } from "../modules/identity";`, /rule 1/],
    ["a folder import along a forbidden edge", "modules/servers/x.ts", `import { a } from "../telemetry";`, /rule 4/],
    ["a folder import from identity", "modules/identity/x.ts", `import { a } from "../servers";`, /rule 4/],
    // Rule 8: the retired game-adapter package, from anywhere and in any form.
    ["a module importing the game-adapter package", "modules/telemetry/x.ts", `import { a } from "@satisfactory-dash/game-adapter";`, /rule 8/],
    ["platform/errors.ts importing game-adapter (its old exemption is gone)", "platform/errors.ts", `export { UpstreamError } from "@satisfactory-dash/game-adapter";`, /rule 8/],
    ["the composition root importing game-adapter", "server.ts", `import { a } from "@satisfactory-dash/game-adapter";`, /rule 8/],
    ["game-adapter fixtures", "modules/map/x.ts", `import { a } from "@satisfactory-dash/game-adapter/fixtures";`, /rule 8/],
    ["game-adapter via a dynamic import", "modules/settings/x.ts", `const m = await import("@satisfactory-dash/game-adapter");`, /rule 8/],
    ["a trailing-slash folder import", "modules/servers/x.ts", `import { a } from "../telemetry/";`, /rule 4/],
    ["a file outside platform/ and modules/ reaching into a module", "routes/x.ts", `import { a } from "../modules/servers/index.js";`, /rule 5/],
    ["a deep import written with a .ts extension", "modules/telemetry/x.ts", `import { b } from "../servers/serverRuntime.ts";`, /rule 2/],
    ["a dynamic import", "platform/x.ts", `const m = await import("../modules/identity/index.js");`, /rule 1/],
    // Rule 6: the frontend-only zod jitless entry, and other subpaths of shared.
    ["a module importing shared/browser", "modules/telemetry/x.ts", `import "@satisfactory-dash/shared/browser";`, /rule 6/],
    ["platform importing shared/browser", "platform/x.ts", `import "@satisfactory-dash/shared/browser";`, /rule 6/],
    ["the composition root importing shared/browser", "server.ts", `import "@satisfactory-dash/shared/browser";`, /rule 6/],
    ["shared/browser as a named import", "modules/identity/x.ts", `import { z } from "@satisfactory-dash/shared/browser";`, /rule 6/],
    ["shared/browser as a dynamic import", "modules/settings/x.ts", `const m = await import("@satisfactory-dash/shared/browser");`, /rule 6/],
    ["shared/browser via require()", "modules/identity/x.ts", `const b = require("@satisfactory-dash/shared/browser");`, /rule 6/],
    ["shared/browser via import = require()", "modules/identity/x.ts", `import b = require("@satisfactory-dash/shared/browser");`, /rule 6/],
    ["shared/browser via a template-literal dynamic import", "modules/identity/x.ts", "const m = await import(`@satisfactory-dash/shared/browser`);", /rule 6/],
    ["shared/browser via a dynamic import with options", "modules/identity/x.ts", `const m = await import("@satisfactory-dash/shared/browser", { with: {} });`, /rule 6/],
    ["shared/browser via a dynamic import with a space before the paren", "modules/identity/x.ts", `const m = await import ( "@satisfactory-dash/shared/browser" );`, /rule 6/],
    ["shared/browser via a multi-line dynamic import", "modules/identity/x.ts", `const m = await import(\n  "@satisfactory-dash/shared/browser",\n);`, /rule 6/],
    ["shared/browser via a typeof import() type query", "modules/identity/x.ts", `type T = typeof import("@satisfactory-dash/shared/browser");`, /rule 6/],
    ["shared/browser via export * as", "platform/x.ts", `export * as ns from "@satisfactory-dash/shared/browser";`, /rule 6/],
    ["shared/browser via a minified import", "platform/x.ts", `import{a}from"@satisfactory-dash/shared/browser";`, /rule 6/],
    ["a trailing-slash shared subpath", "modules/identity/x.ts", `import a from "@satisfactory-dash/shared/";`, /rule 6/],
    ["shared/browser as a re-export", "platform/x.ts", `export * from "@satisfactory-dash/shared/browser";`, /rule 6/],
    ["production code importing shared fixtures", "modules/telemetry/x.ts", `import { f } from "@satisfactory-dash/shared/fixtures";`, /rule 6/],
    ["a deep path into shared", "modules/identity/x.ts", `import { a } from "@satisfactory-dash/shared/src/auth";`, /rule 6/],
  ];
  it.each(bad)("fails on %s", (_name, file, source, expected) => {
    const violations = findViolations(new Map([[file, source]]));
    expect(violations.join("\n")).toMatch(expected);
  });

  it("accepts the allowed shapes", () => {
    const ok = new Map([
      ["modules/telemetry/x.ts", `import { a } from "../map/index.js";\nimport { b } from "../servers/index.js";`],
      ["modules/map/x.ts", `import { E } from "../../platform/errors.js";\nimport { z } from "zod";`],
      ["modules/servers/x.ts", `import type { Request } from "express";\nimport { e } from "../../platform/errorResponse.js";`],
      ["server.ts", `import { a } from "./modules/identity/index.js";\nimport { app } from "./app.js";`],
      ["modules/identity/y.ts", `import { LoginRequestSchema } from "@satisfactory-dash/shared";`],
      ["platform/y.ts", `import type { ApiError } from "@satisfactory-dash/shared";`],
      ["app.ts", `import { endpoints } from "@satisfactory-dash/shared";`],
    ]);
    expect(findViolations(ok)).toEqual([]);
  });

  it("rule 8: backend/package.json lists no game-API client package, and the retired one does not resolve", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<string, unknown>;
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      expect(Object.keys((manifest[field] as Record<string, string> | undefined) ?? {})).not.toContain(GAME_ADAPTER_NAME);
    }
    // Checked inside this repository rather than with require.resolve, which walks up past the repository root (a git
    // worktree under .claude/worktrees/ would resolve the main checkout's copy).
    const repoRoot = new URL("../../", import.meta.url);
    expect(existsSync(new URL("packages/game-adapter", repoRoot))).toBe(false);
    expect(existsSync(new URL(`node_modules/${GAME_ADAPTER_NAME}`, repoRoot))).toBe(false);
    expect(existsSync(new URL(`backend/node_modules/${GAME_ADAPTER_NAME}`, repoRoot))).toBe(false);
  });
});
