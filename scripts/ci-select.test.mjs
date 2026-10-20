import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACES, classify, outputs, readGraph, select, withDependents } from "./ci-select.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deps = readGraph(root);
const pick = (...changed) => select(changed, deps);
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);

test("no file list (push to main, manual run, unknown base) runs everything", () => {
  const result = select(undefined, deps);
  assert.equal(result.all, true);
  assert.deepEqual(result.workspaces, WORKSPACES);
  assert.equal(outputs(result).frontend, true);
});

test("a change to the test or CI setup runs everything", () => {
  for (const file of [
    ".github/workflows/ci.yml",
    ".github/dependabot.yml",
    "package-lock.json",
    "package.json",
    "backend/package.json",
    ".node-version",
    "scripts/ci-select.mjs",
    "scripts/ci-select.test.mjs",
    "scripts/lint/safe-lookup.mjs",
    "frontend/playwright.config.ts",
    "backend/vitest.config.ts",
    "frontend/src/vitest-setup.ts",
  ]) {
    const result = pick("backend/src/app.ts", file);
    assert.equal(result.all, true, file);
    assert.match(result.reason, /setup/, file);
  }
});

test("a path no rule covers runs everything", () => {
  const result = pick("docs/x.md", "newthing/index.ts");
  assert.equal(result.all, true);
  assert.match(result.reason, /newthing\/index\.ts/);
});

test("a backend-only change runs the backend and its jobs, not the frontend's", () => {
  const out = outputs(pick("backend/src/modules/alerts/config.ts"));
  assert.deepEqual(out, {
    all: false,
    reason: "selected: backend",
    workspaces: "backend",
    frontend: false,
    server_manager: false,
    backend: true,
    load: true,
    compose: true,
  });
});

test("a frontend-only change runs the frontend and its e2e, nothing else", () => {
  const out = outputs(pick("frontend/src/power/PowerChart.tsx"));
  assert.equal(out.workspaces, "frontend");
  assert.equal(out.frontend, true);
  assert.equal(out.backend, false);
  assert.equal(out.load, false);
  assert.equal(out.server_manager, false);
});

test("a shared-contract change reaches every workspace that depends on it", () => {
  const result = pick("packages/shared/src/factory.ts");
  assert.equal(result.all, false);
  assert.deepEqual(result.workspaces, WORKSPACES);
});

test("dependents follow the package.json graph", () => {
  assert.deepEqual(pick("agent/src/main.ts").workspaces, ["agent", "server-manager"]);
  assert.deepEqual(pick("packages/game-adapter/src/index.ts").workspaces, [
    "packages/game-adapter",
    "backend",
    "agent",
    "server-manager",
  ]);
  assert.deepEqual(pick("server-manager/src/main.ts").workspaces, ["server-manager"]);
  assert.deepEqual([...withDependents(["x"], new Map([["y", ["x"]], ["z", ["y"]]]))].sort(), ["x", "y", "z"]);
});

test("inputs outside a workspace select the workspaces that read them", () => {
  assert.deepEqual(pick("frontend/src/index.css").workspaces, ["frontend", "server-manager"]);
  assert.deepEqual(pick("docs-vault/raw-sources/captured-responses/x.json").workspaces, [
    "packages/game-adapter",
    "backend",
    "agent",
    "server-manager",
  ]);
  assert.deepEqual(pick("LICENSE").workspaces, ["frontend"]);
  const load = outputs(pick("scripts/load-report.mjs"));
  assert.equal(load.load, true);
  assert.equal(load.workspaces, "");
  const compose = outputs(pick("compose.yaml"));
  assert.equal(compose.compose, true);
  assert.equal(compose.backend, false);
});

test("a docs-only change runs none of the heavy jobs", () => {
  const out = outputs(pick("docs-vault/wiki/log.d/2026-10-20-x.md", "README.md", ".claude/agents/x.md", "docs/lessons.d/x.md"));
  assert.deepEqual(out, {
    all: false,
    reason: "nothing to build or test",
    workspaces: "",
    frontend: false,
    server_manager: false,
    backend: false,
    load: false,
    compose: false,
  });
});

// Guards: these fail when something new isn't mapped.

test("guard: WORKSPACES matches the root package.json workspaces", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const dirs = pkg.workspaces.flatMap((entry) => {
    if (!entry.endsWith("/*")) return [entry];
    const parent = entry.slice(0, -2);
    return readdirSync(path.join(root, parent))
      .map((name) => `${parent}/${name}`)
      .filter((dir) => existsSync(path.join(root, dir, "package.json")));
  });
  assert.deepEqual([...dirs].sort(), [...WORKSPACES].sort(), "add the new workspace to WORKSPACES in scripts/ci-select.mjs");
});

test("guard: the root scripts run every workspace, so a full run covers what a selected run would", () => {
  const { scripts } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  for (const dir of WORKSPACES) {
    const own = JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8")).scripts ?? {};
    for (const name of ["lint", "typecheck", "test", "build"]) {
      if (own[name]) assert.ok(scripts[name].includes(`-w ${dir}`), `root "${name}" doesn't run ${dir}`);
    }
  }
});

test("guard: every tracked file is attributed by a rule", () => {
  const loose = tracked.filter((file) => classify(file) === "unattributed");
  assert.deepEqual(loose, [], "map these paths in scripts/ci-select.mjs (SETUP, INPUTS or NOTHING)");
});

test("guard: every Playwright spec belongs to a workspace whose e2e suite CI runs", () => {
  const E2E = ["frontend", "server-manager"]; // e2e.yml, and verify's "Server manager e2e" step
  const specs = tracked.filter((file) => /\.spec\.[cm]?[jt]sx?$/.test(file) || /(^|\/)playwright\.config\./.test(file));
  assert.ok(specs.length > 0);
  for (const spec of specs) {
    assert.ok(E2E.some((dir) => spec.startsWith(`${dir}/`)), `${spec}: no CI job runs it; wire it up and map it here`);
  }
});

test("guard: a workspace file that names a path outside its workspace is selected with it", () => {
  const RELATIVE = /["'`]((?:\.\.\/)+[\w@.\-/]*)["'`]/g;
  const problems = [];
  for (const file of tracked) {
    const ws = WORKSPACES.find((dir) => file.startsWith(`${dir}/`));
    if (!ws || !/\.(ts|tsx|mts|cts|js|mjs|cjs|json|css)$/.test(file)) continue;
    const text = readFileSync(path.join(root, file), "utf8");
    for (const [, literal] of text.matchAll(RELATIVE)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), literal));
      if (target.startsWith("..") || target === ws || target.startsWith(`${ws}/`)) continue;
      const full = path.join(root, target);
      if (!existsSync(full)) continue; // a made-up path in a test, e.g. an import the boundary tests reject
      const probe = statSync(full).isDirectory() ? `${target.replace(/\/$/, "")}/probe` : target;
      const result = pick(probe);
      if (!result.all && !result.workspaces.includes(ws)) problems.push(`${file} reads ${target}`);
    }
  }
  assert.deepEqual(problems, [], "add an INPUTS rule in scripts/ci-select.mjs for each");
});
