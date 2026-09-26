import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_FLOW, MAX_FILES_LISTED, UI_TIER_LABEL, addedLines, checkTier, isUiTierPath } from "./tier-check.mjs";

const LABELLED = [UI_TIER_LABEL];
const patchOf = (...added) => `@@ -1,2 +1,${2 + added.length} @@\n context\n${added.map((line) => `+${line}`).join("\n")}\n context`;
const file = (filename, extra = {}) => ({ filename, status: "modified", changes: 3, patch: patchOf("const a = 1;"), ...extra });
const pr = (files, labels = LABELLED) => ({ files, labels });

test("a labelled PR whose files are all UI-tier and add no data-flow code passes", () => {
  const result = checkTier(
    pr([
      file("frontend/src/components/AlertsPage.tsx"),
      file("frontend/src/index.css"),
      file("frontend/src/lib/muteTime.ts"),
      { filename: "frontend/e2e/alerts.spec.ts", status: "modified" },
      { filename: "frontend/e2e/__screenshots__/desktop/alerts.png", status: "added" },
      { filename: "docs-vault/wiki/log.d/2026-09-26-alerts-styling.md", status: "added" },
    ]),
  );
  assert.deepEqual(result, { ok: true, problems: [] });
});

test("a PR without the label is not checked (it goes through the normal review), whatever it changes", () => {
  const result = checkTier(pr([file("backend/src/server.ts"), file("frontend/src/api/client.ts", { patch: patchOf("fetch(url)") })], []));
  assert.equal(result.ok, true);
  assert.match(result.skipped, /no tier:ui label/);
});

test("other labels do not turn the check on", () => {
  assert.equal(checkTier(pr([file("backend/src/server.ts")], ["ui", "tier:backend"])).ok, true);
});

test("a labelled PR that changes a file outside the UI-tier paths fails, naming the file and the way out", () => {
  const result = checkTier(pr([file("frontend/src/components/A.tsx"), file("backend/src/server.ts")]));
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /Not a UI-tier PR, request architect review/);
  assert.match(result.problems[0], /backend\/src\/server\.ts/);
  assert.doesNotMatch(result.problems[0], /A\.tsx/);
  assert.match(result.problems[0], /Remove the `tier:ui` label/);
});

test("every path the architect keeps is outside the UI tier", () => {
  for (const name of [
    "packages/shared/src/agent.ts",
    "backend/migrations/1790899200000_agents.sql",
    "frontend/src/api/client.ts",
    "frontend/src/api/nested/deep.ts",
    "frontend/src/auth/session.tsx",
    "frontend/src/demo/handlers.ts",
    "frontend/src/test/browser.ts",
    "frontend/public/privacy.html",
    "frontend/public/_headers",
    ".github/workflows/ci.yml",
    "scripts/log-check.mjs",
    "package.json",
    "package-lock.json",
    "frontend/package.json",
    "frontend/vite.config.ts",
    "frontend/index.html",
    "frontend/src/assets/logo.svg",
    "frontend/src/data.json",
    "docs-vault/wiki/log.md",
    "docs-vault/wiki/decisions/0033-delivery-workflow.md",
  ]) {
    assert.equal(isUiTierPath(name), false, name);
    assert.equal(checkTier(pr([file(name)])).ok, false, name);
  }
});

test("look-alike paths are not UI-tier paths", () => {
  for (const name of [
    "frontend/srcx/App.tsx",
    "frontend/src/App.tsx.bak",
    "frontend/src/demo/handlers.tsx.ts.orig",
    "xfrontend/src/App.tsx",
    "frontend/e2ex/spec.ts",
    "docs-vault/wiki/log.dx/2026-09-26-x.md",
    "frontend/src/../api/client.ts",
    "frontend/e2e/../../backend/src/server.ts",
  ]) {
    assert.equal(isUiTierPath(name), false, name);
  }
});

test("the paths the tier allows are allowed", () => {
  for (const name of [
    "frontend/src/App.tsx",
    "frontend/src/components/deep/nested/X.ts",
    "frontend/src/styles/tokens.css",
    "frontend/src/components/X.test.tsx",
    "frontend/src/demo/fixtures.ts",
    "frontend/src/test/setup.ts",
    "frontend/e2e/anything/at/all.png",
    "docs-vault/wiki/log.d/2026-09-26-x.md",
  ]) {
    assert.equal(isUiTierPath(name), true, name);
  }
});

test("an added data-flow line under frontend/src fails, for every pattern of the amendment", () => {
  for (const pattern of DATA_FLOW) {
    const result = checkTier(pr([file("frontend/src/components/A.tsx", { patch: patchOf(`const x = ${pattern} something;`) })]));
    assert.equal(result.ok, false, pattern);
    assert.match(result.problems[0], /Not a UI-tier PR, request architect review/);
    assert.match(result.problems[0], /A\.tsx/);
    assert.ok(result.problems[0].includes(pattern), pattern);
  }
});

test("the literal patterns are the amendment's thirteen plus the architect's four browser network APIs (`fetch(` is a regex, tested below)", () => {
  assert.deepEqual(DATA_FLOW, [
    "useQuery",
    "useInfiniteQuery",
    "useMutation",
    "queryOptions",
    "apiSend",
    "apiGet",
    "endpoints.",
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "indexedDB",
    "postMessage",
    "dangerouslySetInnerHTML",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "sendBeacon",
  ]);
});

const failsWith = (line, expected) => {
  const result = checkTier(pr([file("frontend/src/components/A.tsx", { patch: patchOf(line) })]));
  assert.equal(result.ok, false, line);
  assert.ok(result.problems[0].includes(expected), `${line} -> ${result.problems[0]}`);
};
const passes = (line) => assert.equal(checkTier(pr([file("frontend/src/components/A.tsx", { patch: patchOf(line) })])).ok, true, line);

test("the four browser network APIs fail, in a call or a type position", () => {
  failsWith("const xhr = new XMLHttpRequest();", "XMLHttpRequest");
  failsWith("const socket = new WebSocket(url);", "WebSocket");
  failsWith("const events = new EventSource('/stream');", "EventSource");
  failsWith("navigator.sendBeacon(url, body);", "sendBeacon");
  failsWith("let s: WebSocket | undefined;", "WebSocket");
});

test("`fetch` is matched with optional whitespace before the parenthesis, however it is spaced", () => {
  for (const line of ["await fetch(url);", "await fetch (url);", "await fetch\t(url);", "await  fetch   (url);", "window.fetch (url)", "const again = refetch();", "return fetch(\n"]) {
    failsWith(line, "fetch(");
  }
  // A word that only contains fetch, or a call on another line, is not a fetch call.
  passes("const fetched = true;");
  passes("// fetch the colours from the theme");
  passes("const prefetchedTabs = new Set();");
});

test("an import of the data layer's package fails, in every import shape", () => {
  for (const line of [
    'import { QueryClient } from "@tanstack/react-query";',
    "import type { QueryKey } from '@tanstack/react-query';",
    'import * as rq from "@tanstack/react-query"',
    '} from "@tanstack/react-query";',
    'const rq = await import("@tanstack/react-query");',
    'export { QueryClient } from "@tanstack/react-query";',
  ]) {
    failsWith(line, "@tanstack/react-query");
  }
  passes('import { Card } from "@tanstack/react-table";');
});

test("an import from a path with an /api or /auth segment fails, in every import shape and spelling", () => {
  const expected = "an import from an api/ or auth/ path";
  for (const line of [
    'import { client } from "../api/client";',
    "import { client } from '../../api/client';",
    'import { client } from "./api";',
    'import { client } from "../api";',
    'import { session } from "@/auth/session";',
    'import { session } from "../auth";',
    '} from "../api/client";',
    'import "../api/setup";',
    'const client = await import("./api/client");',
    'const client = require("../api/client");',
    'export * from "../api/types";',
    "import type { Session } from `../auth/session`;",
  ]) {
    failsWith(line, expected);
  }
});

test("look-alike import paths and plain strings are not import-of-api findings", () => {
  for (const line of [
    'import { Card } from "./components/Card";',
    'import { x } from "../capital/x";',
    'import { x } from "./apiary";',
    'import { x } from "./authors/list";',
    'import { x } from "../rapid/x";',
    'const label = "the api/ folder";',
    "// see the /api/ docs",
    'const path = "/api/servers";', // not an import: the call that would use it is caught by the other patterns
    'import { x } from "./components/auth-badge";',
  ]) {
    passes(line);
  }
});

test("the accepted limits are real, and named in the script: a split token or a case change is not seen", () => {
  passes('const f = window["fe" + "tch"];');
  passes("const s = localstorage;");
  passes("const call = fet"); // a token split across two added lines: neither line has it
  passes("ch(url);");
});

test("only ADDED lines count: a removed or unchanged line with a pattern does not fail", () => {
  const patch = "@@ -1,3 +1,3 @@\n const q = useQuery(a);\n-const old = localStorage.getItem('a');\n+const fresh = 1;";
  assert.equal(checkTier(pr([file("frontend/src/components/A.tsx", { patch })])).ok, true);
});

test("data-flow code in e2e specs or a log fragment is not checked (the rule is about frontend/src)", () => {
  const result = checkTier(
    pr([
      { filename: "frontend/e2e/alerts.spec.ts", status: "modified", patch: patchOf("await page.evaluate(() => localStorage.clear());") },
      { filename: "docs-vault/wiki/log.d/2026-09-26-x.md", status: "added", patch: patchOf("- uses fetch( in the note") },
    ]),
  );
  assert.equal(result.ok, true);
});

test("a data-flow line in a UI-tier file alongside a file outside the paths reports both problems", () => {
  const result = checkTier(pr([file("frontend/src/components/A.tsx", { patch: patchOf("useMutation(x)") }), file("backend/src/x.ts")]));
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 2);
});

test("a rename out of a protected path counts as touching it", () => {
  const result = checkTier(pr([{ filename: "frontend/src/components/api-client.ts", previous_filename: "frontend/src/api/client.ts", status: "renamed", changes: 0 }]));
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /frontend\/src\/api\/client\.ts/);
});

test("a rename into a protected path is refused too", () => {
  const result = checkTier(pr([{ filename: "frontend/src/auth/x.ts", previous_filename: "frontend/src/components/x.ts", status: "renamed", changes: 0 }]));
  assert.equal(result.ok, false);
});

test("deleting a protected file is a change to it", () => {
  assert.equal(checkTier(pr([{ filename: "frontend/src/api/old.ts", status: "removed" }])).ok, false);
});

test("a pure rename inside the UI tier (no patch, no changes) passes; a source file with no patch at all fails closed", () => {
  const rename = { filename: "frontend/src/components/B.tsx", previous_filename: "frontend/src/components/A.tsx", status: "renamed", changes: 0 };
  assert.equal(checkTier(pr([rename])).ok, true);
  const tooBig = checkTier(pr([{ filename: "frontend/src/components/Huge.tsx", status: "modified", changes: 9000 }]));
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.problems[0], /too large for the API/);
});

test("the CI jq shape (previous_filename: null on every file) is understood", () => {
  const result = checkTier(pr([{ filename: "frontend/src/components/A.tsx", status: "modified", previous_filename: null, patch: patchOf("const a = 1;"), changes: 2 }]));
  assert.equal(result.ok, true);
});

test("file names never put anything but printable ASCII into the error line (a newline could start a second workflow command)", () => {
  const result = checkTier(pr([file("backend/x\n::error::pwned.ts")]));
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.problems[0], /\n/);
  assert.match(result.problems[0], /backend\/x\?::error::pwned\.ts/);
});

test("a list as long as the API's cap may be truncated, so it fails closed", () => {
  const many = Array.from({ length: MAX_FILES_LISTED }, (_, i) => file(`frontend/src/components/C${i}.tsx`));
  const result = checkTier(pr(many));
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /more than the API lists/);
  assert.equal(checkTier(pr(many.slice(1))).ok, true);
});

test("addedLines reads a patch: added lines only, without the plus", () => {
  assert.deepEqual(addedLines("@@ -1 +1,2 @@\n a\n+b\n-c\n+d\n+++ e"), ["b", "d", "++ e"]);
});

// The CLI, as CI runs it: the label from PR_LABELS_JSON, the files from the file PR_FILES_FILE names.
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "tier-check.mjs");
const run = (labels, files, extraEnv = {}) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tier-check-"));
  try {
    const filesPath = path.join(dir, "files.json");
    writeFileSync(filesPath, JSON.stringify(files));
    return spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH, PR_LABELS_JSON: JSON.stringify(labels), PR_FILES_FILE: filesPath, ...extraEnv }, encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("CLI: a labelled UI-tier PR exits 0", () => {
  const result = run(LABELLED, [file("frontend/src/components/A.tsx")]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /UI-tier check passed/);
});

test("CLI: a labelled PR outside the paths exits 1 with an ::error:: annotation", () => {
  const result = run(LABELLED, [file("backend/src/server.ts")]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^::error::Not a UI-tier PR, request architect review/m);
});

test("CLI: no label exits 0 without reading the files list", () => {
  const result = run([], [file("backend/src/server.ts")], { PR_FILES_FILE: "/no/such/file" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped/);
});

test("CLI: a labelled PR with an unreadable files list fails closed", () => {
  const result = run(LABELLED, [], { PR_FILES_FILE: "/no/such/file" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PR_FILES_FILE is missing or not JSON/);
});

test("an added line whose text starts with '++' (patch line '+++...') is still read: ++counter; useQuery()", () => {
  const patch = "@@ -1 +1,2 @@\n a\n+++counter; useQuery(x)";
  assert.equal(checkTier(pr([file("frontend/src/components/A.tsx", { patch })])).ok, false);
});

test("the CI jq shape gives patch: null for a file with no patch: a pure rename passes, a too-large diff fails closed with a message", () => {
  const rename = { filename: "frontend/src/components/B.tsx", previous_filename: "frontend/src/components/A.tsx", status: "renamed", changes: 0, patch: null };
  assert.equal(checkTier(pr([rename])).ok, true);
  const big = checkTier(pr([{ filename: "frontend/src/components/Huge.tsx", status: "modified", changes: 9000, patch: null, previous_filename: null }]));
  assert.equal(big.ok, false);
  assert.match(big.problems[0], /too large for the API/);
});

test("CLI: a files list that is not an array (an API error object) fails closed with an ::error:: line, not a stack trace", () => {
  const result = run(LABELLED, { message: "Server Error" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^::error::PR_FILES_FILE is not a JSON array/m);
});

test("the workflow step sets pipefail, so a failed `gh api --paginate` cannot leave a partial or empty files list that passes", () => {
  const ci = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "ci.yml"), "utf8");
  const step = ci.slice(ci.indexOf("UI tier (ADR-0033 amendment 3)"));
  assert.match(step.slice(0, step.indexOf("setup-node")), /set -o pipefail/);
});

test("CLI: missing labels fail closed", () => {
  const result = spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PR_LABELS_JSON is missing or not JSON/);
});
