import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACES, classify, importsPackage, outputs, readGraph, select, withDependents } from "./ci-select.mjs";

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
    systemd: false,
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
    "frontend",
    "backend",
    "agent",
    "server-manager",
  ]);
  assert.ok(pick("backend/src/modules/telemetry/itemForms.generated.json").workspaces.includes("frontend"));
  assert.deepEqual(pick("LICENSE").workspaces, ["frontend"]);
  const load = outputs(pick("scripts/load-report.mjs"));
  assert.equal(load.load, true);
  assert.equal(load.workspaces, "");
  const compose = outputs(pick("compose.yaml"));
  assert.equal(compose.compose, true);
  assert.equal(compose.backend, false);
  const unit = outputs(pick("agent/packaging/linux/satis-agent.service"));
  assert.equal(unit.systemd, true);
  assert.equal(unit.backend, false);
  assert.equal(outputs(pick("agent/src/main.ts")).systemd, false);
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
    systemd: false,
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

test("importsPackage sees every way a source can name another workspace, and not a bare word", () => {
  for (const text of [
    `import { a } from "backend/src/x";`,
    `import type { A } from 'backend';`,
    `export * from "backend/src/x";`,
    "const m = await import(`backend/src/x`);",
    `const m = require("backend/x");`,
    `import "backend/side-effect";`,
  ]) assert.equal(importsPackage(text, "backend"), true, text);
  for (const text of [`const kind = "backend";`, `import { a } from "backend-utils";`, `// backend`, `import { a } from "./backend/x";`]) {
    assert.equal(importsPackage(text, "backend"), false, text);
  }
});

test("readGraph finds undeclared and type-only imports of scoped and unscoped workspaces", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "ci-select-"));
  try {
    const put = (file, body) => {
      mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true });
      writeFileSync(path.join(tmp, file), body);
    };
    for (const dir of WORKSPACES) put(`${dir}/package.json`, JSON.stringify({ name: dir === "backend" ? "backend" : `@x/${dir.replace("/", "-")}` }));
    put("frontend/src/a.ts", `import type { T } from "backend/src/types";`); // unscoped, type-only, undeclared
    put("agent/src/a.ts", "const s = await import(`@x/packages-shared`);"); // template literal
    put("server-manager/src/a.ts", `export const kind = "backend";`); // a bare word is not an import
    const graph = readGraph(tmp);
    assert.deepEqual(graph.get("frontend"), ["backend"]);
    assert.deepEqual(graph.get("agent"), ["packages/shared"]);
    assert.deepEqual(graph.get("server-manager"), []);
    assert.ok(select(["backend/src/x.ts"], graph).workspaces.includes("frontend"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("guard: a path built from separate `..` segments is selected with the workspace that reads it", () => {
  const SEGMENTS = /(?:["'`]\.\.["'`]\s*,\s*)+["'`]([\w@.\-/]+)["'`]/g;
  const problems = [];
  for (const file of tracked) {
    const ws = WORKSPACES.find((dir) => file.startsWith(`${dir}/`));
    if (!ws || !/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(file)) continue;
    const text = readFileSync(path.join(root, file), "utf8");
    for (const match of text.matchAll(SEGMENTS)) {
      const ups = match[0].match(/\.\./g).length;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), ...Array(ups).fill(".."), match[1]));
      if (target.startsWith("..") || target === ws || target.startsWith(`${ws}/`) || !existsSync(path.join(root, target))) continue;
      const result = pick(target);
      if (!result.all && !result.workspaces.includes(ws)) problems.push(`${file} reads ${target}`);
    }
  }
  assert.deepEqual(problems, [], "add an INPUTS rule in scripts/ci-select.mjs for each");
});
