// Picks what a pull request's CI has to run, from the files it changes. The unit is the workspace: a change
// to a workspace runs that workspace's lint, typecheck, unit tests and build, and the same for every workspace
// that depends on it (read from the workspaces' package.json files and imports), so a change to packages/shared still
// reaches the frontend, the backend and the agent. The heavy jobs follow from that: the frontend's Playwright
// suite (e2e.yml) runs when the frontend is selected, the server manager's when it is, and the backend image,
// compose and load-smoke jobs when the backend is.
//
// It may run too much, never too little:
// - pushes to main, manual runs and an unknown base run everything (the workflow passes no file list);
// - a change to the test or CI setup runs everything (SETUP);
// - a path no rule below attributes runs everything.
// The script tests (`npm run test:scripts`), the log-fragment check and the security job run on every PR,
// so a docs-only change still gets those.
//
//   node scripts/ci-select.mjs [<changed-files.txt>]   prints GitHub Actions step outputs
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every npm workspace, in the order the root scripts run them. A test checks this against package.json. */
export const WORKSPACES = ["packages/shared", "packages/game-adapter", "frontend", "backend", "agent", "server-manager"];

/** Files that decide how the tests run rather than what they test: any change runs everything. */
export const SETUP = [
  /^\.github\//,
  /(^|\/)package(-lock)?\.json$/,
  /^\.node-version$/,
  /^\.nvmrc$/,
  /^\.gitattributes$/,
  /^\.gitignore$/,
  /^scripts\/ci-select(\.test)?\.mjs$/,
  /^scripts\/lint\//, // the oxlint plugin every workspace loads
  /(^|\/)(vitest|playwright)\.config\.[cm]?[jt]s$/,
  /(^|\/)vitest-setup\.[jt]sx?$/,
];

/**
 * Paths outside a workspace that a workspace (or a job) reads anyway, and the targets they select. A target is
 * a workspace directory, or `load` (the load-smoke job) or `compose` (the compose job). Workspace targets also
 * select their dependents.
 */
export const INPUTS = [
  [/^docs-vault\/raw-sources\//, ["packages/game-adapter", "backend"]], // captured responses the tests replay
  [/^load\//, ["backend", "load"]], // backend/scripts/load-seed.ts imports load/lib
  [/^scripts\/load-report\.mjs$/, ["load"]],
  [/^frontend\/src\/index\.css$/, ["server-manager"]], // the server manager's build and tests read its tokens
  [/^LICENSE$/, ["frontend"]], // frontend/e2e/legal.spec.ts reads it
  [/^\.env\.example$/, ["backend"]],
  [/^compose\.yaml$/, ["compose"]],
];

/** Paths no build or test reads. The always-on checks (script tests, log fragment, security) still run. */
export const NOTHING = [
  /^docs-vault\//,
  /^docs\//,
  /^vendor\//,
  /^\.claude\//,
  /^infra\//, // terraform.yml has its own paths filter
  /^\.githooks\//,
  /^scripts\//, // root scripts: covered by `npm run test:scripts`, which always runs
  /^[^/]+\.md$/,
];

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "playwright-report", "test-results"]);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return SOURCE.test(entry.name) ? [full] : [];
  });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the source imports, re-exports, requires or dynamically imports the package `name` (or a path in it). */
export function importsPackage(text, name) {
  return new RegExp(`(?:\\bfrom|\\bimport|\\brequire)\\s*\\(?\\s*["'\`]${escapeRe(name)}(?:["'\`]|/)`).test(text);
}

/**
 * The workspaces each workspace depends on: the ones its package.json lists, and the ones its source imports by
 * package name (npm hoists every workspace to the root node_modules, so an undeclared import still resolves).
 */
export function readGraph(root = ROOT) {
  const pkgs = WORKSPACES.map((dir) => ({ dir, pkg: JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8")) }));
  const byName = new Map(pkgs.map(({ dir, pkg }) => [pkg.name, dir]));
  const scoped = [...byName.keys()].filter((name) => name.startsWith("@"));
  const deps = new Map();
  for (const { dir, pkg } of pkgs) {
    const names = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }));
    for (const file of sourceFiles(path.join(root, dir))) {
      const text = readFileSync(file, "utf8");
      for (const name of scoped) if ([`"`, `'`, "`"].some((q) => text.includes(q + name))) names.add(name);
      // Unscoped names ("backend", "frontend") are common words, so only an import or require of one counts.
      for (const name of byName.keys()) {
        if (!name.startsWith("@") && importsPackage(text, name)) names.add(name);
      }
    }
    names.delete(pkg.name);
    deps.set(dir, [...names].filter((name) => byName.has(name)).map((name) => byName.get(name)));
  }
  return deps;
}

/** The given workspaces plus every workspace that depends on one of them, directly or not. */
export function withDependents(dirs, deps) {
  const out = new Set(dirs);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [dir, uses] of deps) {
      if (!out.has(dir) && uses.some((d) => out.has(d))) {
        out.add(dir);
        grew = true;
      }
    }
  }
  return out;
}

const workspaceOf = (file) => WORKSPACES.find((dir) => file.startsWith(`${dir}/`));

/** What one changed path selects: "setup", "unattributed", or a list of targets (possibly empty). */
export function classify(file) {
  if (SETUP.some((re) => re.test(file))) return "setup";
  const targets = INPUTS.filter(([re]) => re.test(file)).flatMap(([, t]) => t);
  const ws = workspaceOf(file);
  if (ws) targets.push(ws);
  if (targets.length) return targets;
  if (NOTHING.some((re) => re.test(file))) return [];
  return "unattributed";
}

const ALL_TARGETS = [...WORKSPACES, "load", "compose"];

/**
 * @param {string[] | undefined} changed the PR's changed paths; undefined when there is no PR to compare with
 * @returns {{ all: boolean, reason: string, workspaces: string[], targets: Set<string> }}
 */
export function select(changed, deps) {
  const everything = (reason) => ({ all: true, reason, workspaces: [...WORKSPACES], targets: new Set(ALL_TARGETS) });
  if (!changed) return everything("no pull request to compare with");
  const setup = changed.filter((f) => classify(f) === "setup");
  if (setup.length) return everything(`the test or CI setup changed (${setup.slice(0, 3).join(", ")})`);
  const loose = changed.filter((f) => classify(f) === "unattributed");
  if (loose.length) return everything(`no rule covers ${loose.slice(0, 3).join(", ")}`);
  const direct = new Set(changed.flatMap((f) => classify(f)));
  const ws = withDependents(WORKSPACES.filter((d) => direct.has(d)), deps);
  const targets = new Set([...direct, ...ws]);
  const workspaces = WORKSPACES.filter((d) => ws.has(d));
  const reason = targets.size ? `selected: ${[...ALL_TARGETS].filter((t) => targets.has(t)).join(", ")}` : "nothing to build or test";
  return { all: false, reason, workspaces, targets };
}

/** The step outputs the workflows read. */
export function outputs(result) {
  const has = (t) => result.targets.has(t);
  return {
    all: result.all,
    reason: result.reason,
    workspaces: result.workspaces.join(" "),
    frontend: has("frontend"),
    server_manager: has("server-manager"),
    backend: has("backend"),
    load: has("backend") || has("load"),
    compose: has("backend") || has("compose"),
  };
}

function main(args) {
  const file = args[0];
  const changed = file && existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean) : undefined;
  const result = select(changed, readGraph());
  console.error(`ci-select: ${result.all ? "everything" : "some"} (${result.reason})`);
  for (const [key, value] of Object.entries(outputs(result))) console.log(`${key}=${value}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
