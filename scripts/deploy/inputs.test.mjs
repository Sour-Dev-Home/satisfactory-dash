import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INPUTS_LABEL, INPUT_PATHS, inputsAt, inputsHash, isInputs } from "./inputs.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

const ID = (c) => c.repeat(40);
/** `git ls-tree -z` output for the given entries ({ path: [mode, type, id] }). */
const lsTree = (entries) => Object.entries(entries).map(([p, [mode, type, id]]) => `${mode} ${type} ${id}\t${p}\0`).join("");
const BASE = {
  backend: ["040000", "tree", ID("1")],
  "package-lock.json": ["100644", "blob", ID("2")],
  "package.json": ["100644", "blob", ID("3")],
  "packages/game-adapter": ["040000", "tree", ID("4")],
  "packages/shared": ["040000", "tree", ID("5")],
  ".github/workflows/image.yml": ["100644", "blob", ID("8")],
};

test("the workflow that sets the build's target, platforms and labels is a required input", () => {
  assert.ok(INPUT_PATHS.some((e) => e.path === ".github/workflows/image.yml" && e.required));
});

test("the hash is stable, 64 hex, and independent of git's listing order", () => {
  const h = inputsHash(lsTree(BASE));
  assert.ok(isInputs(h));
  const reversed = Object.fromEntries(Object.entries(BASE).reverse());
  assert.equal(inputsHash(lsTree(reversed)), h);
});

test("any change to any input's id, mode or type changes the hash", () => {
  const h = inputsHash(lsTree(BASE));
  for (const p of Object.keys(BASE)) {
    const [mode, type, id] = BASE[p];
    assert.notEqual(inputsHash(lsTree({ ...BASE, [p]: [mode, type, ID("9")] })), h, `${p} id`);
    if (type === "blob") assert.notEqual(inputsHash(lsTree({ ...BASE, [p]: ["100755", type, id] })), h, `${p} mode`);
  }
  // Two inputs swapping ids is a change too (the path is hashed with its id).
  assert.notEqual(inputsHash(lsTree({ ...BASE, "packages/shared": BASE["packages/game-adapter"], "packages/game-adapter": BASE["packages/shared"] })), h);
});

test("adding a root .dockerignore changes the hash; it is optional today", () => {
  const h = inputsHash(lsTree(BASE));
  assert.notEqual(inputsHash(lsTree({ ...BASE, ".dockerignore": ["100644", "blob", ID("6")] })), h);
});

test("a missing required input, an extra path or an odd entry fails instead of hashing less", () => {
  for (const p of Object.keys(BASE)) {
    const { [p]: _gone, ...rest } = BASE;
    assert.throws(() => inputsHash(lsTree(rest)), new RegExp(`build input ${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not in the commit`));
  }
  assert.throws(() => inputsHash(lsTree({ ...BASE, frontend: ["040000", "tree", ID("7")] })), /not build inputs: frontend/);
  assert.throws(() => inputsHash(`${lsTree(BASE)}garbage\0`), /unexpected git ls-tree entry/);
  assert.throws(() => inputsHash(""), /build input backend is not in the commit/);
});

test("inputsAt asks git for exactly the input paths at one revision, and refuses option-like revisions", () => {
  let seen;
  const h = inputsAt("abc123", (args) => ((seen = args), lsTree(BASE)));
  assert.equal(h, inputsHash(lsTree(BASE)));
  assert.deepEqual(seen, ["ls-tree", "-z", "--full-tree", "abc123", "--", ...INPUT_PATHS.map((e) => e.path)]);
  for (const bad of ["--output=/tmp/x", "-c", "", "a b", "x;y", null, 7]) {
    assert.throws(() => inputsAt(bad, () => lsTree(BASE)), /not a revision/, String(bad));
  }
});

test("inputsAt on this repository's HEAD", () => {
  assert.ok(isInputs(inputsAt("HEAD")));
});

test("isInputs: exactly 64 lower-case hex characters", () => {
  assert.ok(isInputs("a".repeat(64)));
  for (const bad of ["A".repeat(64), "a".repeat(63), "a".repeat(65), `sha256:${"a".repeat(64)}`, "", null, undefined, 7, ["a".repeat(64)]]) {
    assert.ok(!isInputs(bad), String(bad));
  }
});

// --- Every build input is hashed (ADR-0054 D1) ---

/** The instructions of a Dockerfile, with line continuations joined and comments dropped. */
function instructions(dockerfile) {
  const out = [];
  let cur = "";
  for (const raw of dockerfile.split(/\r?\n/)) {
    if (!cur && /^\s*#/.test(raw)) continue;
    if (cur && /^\s*#/.test(raw)) continue; // a comment inside a continued instruction
    const line = raw.replace(/\s+$/, "");
    if (line.endsWith("\\")) {
      cur += `${line.slice(0, -1)} `;
      continue;
    }
    cur += line;
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The build-context sources of every COPY and ADD that does not copy from a stage or image (`--from`). */
function contextSources(dockerfile) {
  const sources = [];
  for (const ins of instructions(dockerfile)) {
    const m = ins.match(/^(COPY|ADD)\s+(.*)$/i);
    if (!m) continue;
    let rest = m[2];
    const flags = [];
    while (/^--\S+/.test(rest)) {
      const f = rest.match(/^(--\S+)\s*/);
      flags.push(f[1]);
      rest = rest.slice(f[0].length);
    }
    if (flags.some((f) => /^--from=/i.test(f))) continue;
    const args = rest.startsWith("[") ? JSON.parse(rest) : rest.split(/\s+/);
    assert.ok(args.length >= 2, `COPY/ADD with no destination: ${ins}`);
    sources.push(...args.slice(0, -1));
  }
  return sources;
}

const normalize = (p) => path.posix.normalize(p).replace(/^\.\//, "").replace(/\/+$/, "");
// Any `..` segment is refused outright, so `backend/../frontend` can't pass as under `backend`.
const covered = (src) => !src.split("/").includes("..") && INPUT_PATHS.some(({ path: p }) => normalize(src) === p || normalize(src).startsWith(`${p}/`));

test("every COPY source in backend/Dockerfile is a hashed build input", () => {
  const dockerfile = read("backend/Dockerfile");
  const sources = contextSources(dockerfile);
  assert.ok(sources.length >= 8, `parsed the Dockerfile's COPY lines (${sources.length})`);
  for (const src of sources) {
    assert.ok(!/[*?[]/.test(src) || covered(src.split(/[*?[]/)[0]), `glob source outside the inputs: ${src}`);
    assert.ok(!/^\.\.?$|^\.\.\//.test(src), `${src} copies the whole context or outside it; hash the whole repository instead`);
    assert.ok(covered(src), `${src} is copied by backend/Dockerfile but not in INPUT_PATHS (scripts/deploy/inputs.mjs)`);
  }
  // Nothing else reads the build context: no bind mounts of it, no remote ADD.
  for (const ins of instructions(dockerfile)) {
    if (/^RUN\b/i.test(ins)) assert.doesNotMatch(ins, /--mount=(?=[^\s]*type=bind)(?![^\s]*from=)/i, `RUN binds the build context: ${ins}`);
    if (/^ADD\b/i.test(ins)) assert.doesNotMatch(ins, /https?:\/\/|git@/i, `ADD from the network: ${ins}`);
  }
});

test("the coverage check itself catches an uncovered COPY, a whole-context COPY and a bind mount", () => {
  const caught = (dockerfile) => {
    try {
      const srcs = contextSources(dockerfile);
      return srcs.some((s) => !covered(s) || /^\.\.?$/.test(s));
    } catch {
      return true;
    }
  };
  assert.ok(caught("FROM x\nCOPY frontend/dist /app\n"));
  assert.ok(caught("FROM x\nCOPY --chown=node:node scripts \\\n  /s\n"));
  assert.ok(caught('FROM x\nCOPY ["tsconfig.base.json", "/repo/"]\n'));
  assert.ok(caught("FROM x\nCOPY . /repo\n"));
  assert.ok(caught("FROM x\nCOPY backend/../frontend /x\n"), "a .. segment never counts as under an input");
  assert.ok(caught("FROM x\nCOPY <<EOF /x\nhi\nEOF\n"), "a heredoc source is not a hashed path");
  assert.ok(caught("FROM x\nADD packages/shared docs /repo/\n"), "every source of a multi-source COPY is checked");
  assert.ok(!caught("FROM x\nCOPY --from=build /repo/frontend /x\nCOPY ./backend/ /b\n"), "--from and ./ forms are fine");
  assert.match("RUN --mount=type=bind,source=frontend,target=/f true", /--mount=(?=[^\s]*type=bind)(?![^\s]*from=)/i);
  assert.doesNotMatch("RUN --mount=type=cache,target=/root/.npm npm ci", /--mount=(?=[^\s]*type=bind)(?![^\s]*from=)/i);
});

test("the ignore file BuildKit uses is inside a hashed input", () => {
  // BuildKit reads <Dockerfile>.dockerignore before a root .dockerignore; both are covered.
  assert.ok(existsSync(path.join(ROOT, "backend/Dockerfile.dockerignore")));
  assert.ok(covered("backend/Dockerfile.dockerignore"));
  assert.ok(covered(".dockerignore"));
});

test("Backend images builds from backend/Dockerfile with the repository root as context, and stamps the hash", () => {
  const yml = read(".github/workflows/image.yml");
  const push = yml.slice(yml.indexOf("\n  push:"));
  assert.ok(push.length > 100, "the push job is there");
  for (const job of [yml.slice(0, yml.indexOf("\n  push:")), push]) {
    for (const ctx of job.matchAll(/^\s+context: (.+)$/gm)) assert.equal(ctx[1].trim(), ".");
    for (const file of job.matchAll(/^\s+file: (.+)$/gm)) assert.equal(file[1].trim(), "backend/Dockerfile");
  }
  assert.match(push, /node scripts\/deploy\/inputs\.mjs "\$GITHUB_SHA"/);
  assert.ok(push.includes(`${INPUTS_LABEL}=\${{ steps.inputs.outputs.hash }}`), "the push job labels both images");
  assert.ok(push.indexOf("id: inputs") < push.indexOf("id: push"), "the hash is computed before the build");
  // #561 / PR #640: the provenance attestation stays.
  assert.match(push, /uses: actions\/attest-build-provenance@[0-9a-f]{40} #/);
  assert.match(push, /subject-digest: \$\{\{ steps\.push\.outputs\.digest \}\}/);
});
