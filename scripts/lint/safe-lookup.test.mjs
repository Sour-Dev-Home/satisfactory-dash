// #368: runs the REAL oxlint with the safe-lookup plugin on known-bad and known-good code. The plugin uses oxlint's
// alpha JS-plugin API, so this is also the guard for an oxlint bump: if the plugin stops loading or reporting, the
// "flagged" cases below fail loudly instead of the rules going quiet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OXLINT = path.join(root, "node_modules", "oxlint", "bin", "oxlint");
const PLUGIN = path.join(root, "scripts", "lint", "safe-lookup.mjs");

/** Lints each named snippet as its own file; returns the safe-lookup rule names reported per snippet. */
function lint(snippets) {
  const dir = mkdtempSync(path.join(tmpdir(), "safe-lookup-test-"));
  try {
    writeFileSync(
      path.join(dir, ".oxlintrc.json"),
      JSON.stringify({
        jsPlugins: [pathToFileURL(PLUGIN).href],
        rules: { "safe-lookup/no-in-operator": "error", "safe-lookup/no-table-index": "error" },
      }),
    );
    for (const [name, code] of Object.entries(snippets)) writeFileSync(path.join(dir, `${name}.ts`), code);
    let output;
    try {
      output = execFileSync(process.execPath, [OXLINT, "-c", ".oxlintrc.json", "-f", "json", "."], { cwd: dir, encoding: "utf8" });
    } catch (error) {
      // oxlint exits 1 when it reports errors; anything else (a plugin that fails to load) has no JSON to show.
      output = error.stdout;
      if (!output) throw new Error(`oxlint failed without output: ${error.stderr}`);
    }
    const report = JSON.parse(output);
    const found = Object.fromEntries(Object.keys(snippets).map((name) => [name, []]));
    for (const diagnostic of report.diagnostics ?? []) {
      const name = path.basename(diagnostic.filename, ".ts");
      const rule = /safe-lookup\(([a-z-]+)\)/.exec(diagnostic.code ?? "")?.[1];
      if (rule && found[name]) found[name].push(rule);
    }
    return found;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const found = lint({
  // #361, before the fix: the metric registry checked a label name and a metric name with plain lookups.
  metric361Registry: `
    const METRIC_REGISTRY = { http_requests: { labels: { route: 1, status_class: 1 } } };
    export function check(metric: string, labels: Record<string, string>) {
      const definition = METRIC_REGISTRY[metric as keyof typeof METRIC_REGISTRY];
      if (!definition) throw new Error("unknown metric");
      for (const key of Object.keys(labels)) if (!(key in definition.labels)) throw new Error("unknown label");
    }`,
  // #361, fixed.
  metric361Fixed: `
    const METRIC_REGISTRY = { http_requests: { labels: { route: 1, status_class: 1 } } };
    export function check(metric: string, labels: Record<string, string>) {
      if (!Object.hasOwn(METRIC_REGISTRY, metric)) throw new Error("unknown metric");
      for (const key of Object.keys(labels)) if (!Object.hasOwn(METRIC_REGISTRY.http_requests.labels, key)) throw new Error("unknown label");
    }`,
  // #367, before the fix: mapNodeType looked the raw FRM name up directly.
  nodeType367: `
    const KNOWN_NODE_TYPES: Record<string, string> = { "Resource Node": "resourceNode", "Fracking Core": "frackingCore" };
    export const mapNodeType = (raw: string) => KNOWN_NODE_TYPES[raw] ?? raw.toLowerCase();`,
  // #367, fixed; and the same with the shared helper.
  nodeType367Fixed: `
    const KNOWN_NODE_TYPES: Record<string, string> = { "Resource Node": "resourceNode" };
    export const mapNodeType = (raw: string) => (Object.hasOwn(KNOWN_NODE_TYPES, raw) ? KNOWN_NODE_TYPES[raw]! : raw.toLowerCase());`,
  nodeTypeOwnValue: `
    declare function ownValue<T extends object>(table: T, key: PropertyKey): T[keyof T] | undefined;
    const KNOWN_NODE_TYPES: Record<string, string> = { "Resource Node": "resourceNode" };
    export const mapNodeType = (raw: string) => ownValue(KNOWN_NODE_TYPES, raw) ?? raw.toLowerCase();`,
  // A Map is the other fix.
  mapLookup: `
    const KNOWN = new Map([["Resource Node", "resourceNode"]]);
    export const f = (raw: string) => KNOWN.get(raw) ?? raw;`,
  // Allowed by design: a literal key is written in the code, not data (TypeScript's narrowing idiom), including a
  // literal prototype name.
  literalIn: `export const f = (value: { route: string } | { id: number }) => ("route" in value ? value.route : "");`,
  literalPrototypeIn: `export const f = (obj: object) => "constructor" in obj;`,
  literalIndex: `const TABLE = { a: 1 }; export const f = () => TABLE["a"];`,
  lowercaseTable: `const table: Record<string, number> = {}; export const f = (k: string) => table[k];`,
  // Flagged: any variable key, whatever its type.
  variableIn: `export const f = (key: string, obj: object) => key in obj;`,
  templateKey: `const STATE_COLOR: Record<string, string> = {}; export const f = (s: string) => STATE_COLOR[\`\${s}\`];`,
  memberKey: `const STATE_COLOR: Record<string, string> = {}; export const f = (b: { state: string }) => STATE_COLOR[b.state];`,
  // The recommended ternary counts only when its guard checks the same table and key, and the lookup is its true branch.
  guardAs: `const TABLE: Record<string, string> = {}; export const f = (k: string) => (Object.hasOwn(TABLE, k) ? (TABLE[k] as string) : "x");`,
  guardOtherKey: `const TABLE: Record<string, string> = {}; export const f = (k: string, j: string) => (Object.hasOwn(TABLE, k) ? TABLE[j] : "x");`,
  guardOtherTable: `const TABLE: Record<string, string> = {}; const U = {}; export const f = (k: string) => (Object.hasOwn(U, k) ? TABLE[k] : "x");`,
  guardNegated: `const TABLE: Record<string, string> = {}; export const f = (k: string) => (!Object.hasOwn(TABLE, k) ? TABLE[k] : "x");`,
  guardElseBranch: `const TABLE: Record<string, string> = {}; export const f = (k: string) => (Object.hasOwn(TABLE, k) ? "x" : TABLE[k]);`,
  guardInIf: `const TABLE: Record<string, string> = {}; export const f = (k: string) => { if (Object.hasOwn(TABLE, k)) return TABLE[k]; return "x"; };`,
  // Found by the fresh-eyes pass: destructuring a computed key reads an inherited member exactly like `TABLE[k]`.
  destructureComputed: `const TABLE: Record<string, number> = { a: 1 }; export const f = (k: string) => { const { [k]: v } = TABLE; return v; };`,
  destructureAssign: `const TABLE: Record<string, number> = {}; let v: number | undefined; export const f = (k: string) => { ({ [k]: v } = TABLE); return v; };`,
  destructureLiteral: `const TABLE = { a: 1 }; export const f = () => { const { ["a"]: v } = TABLE; return v; };`,
  destructureLowercase: `const table: Record<string, number> = {}; export const f = (k: string) => { const { [k]: v } = table; return v; };`,
  // Found by the fresh-eyes pass: the guard, with the lookup written `TABLE?.[k]` (a ChainExpression wrapper).
  guardOptionalChain: `const TABLE: Record<string, string> = {}; export const f = (k: string) => (Object.hasOwn(TABLE, k) ? TABLE?.[k] : "x");`,
  // The ChainExpression exemption must stay as narrow as the non-chain guard: same table, same key, true branch only.
  guardOtherKeyChain: `const TABLE: Record<string, string> = {}; export const f = (k: string, j: string) => (Object.hasOwn(TABLE, k) ? TABLE?.[j] : "x");`,
  guardOtherTableChain: `const TABLE: Record<string, string> = {}; const U = {}; export const f = (k: string) => (Object.hasOwn(U, k) ? TABLE?.[k] : "x");`,
  guardElseBranchChain: `const TABLE: Record<string, string> = {}; export const f = (k: string) => (Object.hasOwn(TABLE, k) ? "x" : TABLE?.[k]);`,
  // Fresh-eyes pass: destructuring inside a for-of body reads the same TABLE per iteration, same as a plain const.
  destructureForOfBody: `
    const TABLE: Record<string, number> = { a: 1 };
    export const f = (keys: string[]) => { for (const k of keys) { const { [k]: v } = TABLE; console.log(v); } };`,
  // A destructured parameter default (`= TABLE`) sits under an AssignmentPattern.
  destructureParamDefault: `
    const TABLE: Record<string, number> = { a: 1 };
    export const f = (k: string, { [k]: v }: any = TABLE) => v;`,
  // Realistic shapes not yet in the fixture: a rest sibling, a function declaration default, a method default.
  destructureRestSibling: `
    const TABLE: Record<string, number> = { a: 1 };
    export const f = (k: string) => { const { [k]: v, ...rest } = TABLE; return [v, rest]; };`,
  destructureFunctionDeclDefault: `
    const TABLE: Record<string, number> = { a: 1 };
    export function f(k: string, { [k]: v }: any = TABLE) { return v; }`,
  destructureMethodDefault: `
    const TABLE: Record<string, number> = { a: 1 };
    export class C { f(k: string, { [k]: v }: any = TABLE) { return v; } }`,
  destructureObjectMethodDefault: `
    const TABLE: Record<string, number> = { a: 1 };
    export const obj = { f(k: string, { [k]: v }: any = TABLE) { return v; } };`,
  // A catch-bound identifier matching the naming convention is treated like any other table: the rule is name-based,
  // not scope-aware, by design (same as any other Identifier check in this plugin).
  destructureCatchBinding: `
    export const f = (k: string) => { try { throw {}; } catch (TABLE) { const { [k]: v } = TABLE; return v; } };`,
  // A cast around the table itself (third fresh-eyes round).
  destructureAsExpressionSource: `
    const TABLE: Record<string, number> = { a: 1 };
    export const f = (k: string) => { const { [k]: v } = TABLE as Record<string, number>; return v; };`,
  memberAsExpressionSource: `
    const TABLE: Record<string, number> = { a: 1 };
    export const f = (k: string) => (TABLE as Record<string, number>)[k];`,
  // False positive check: an object *literal* using a computed table-named key isn't a pattern at all.
  objectLiteralNotPattern: `
    const TABLE: Record<string, number> = { a: 1 };
    export const f = (k: string) => ({ [k]: TABLE });`,
  // False positive check: the pattern's own default *value* mentions the table; the destructuring *source* does not.
  destructureDefaultValueIsTable: `
    const TABLE: Record<string, number> = { a: 1 };
    const other: Record<string, number> = {};
    export const f = (k: string) => { const { [k]: v = TABLE.a } = other; return v; };`,
  // False positive check: the selector dropped [object.type='Identifier'], so these must still not match through
  // tableName's Identifier check on a MemberExpression object.
  thisMember: `
    class C { X: Record<string, number> = {}; f(k: string) { return this.X[k]; } }`,
  objectConstMember: `
    const obj = { CONST: { a: 1 } as Record<string, number> };
    export const f = (k: string) => obj.CONST[k];`,
  enumLikeMember: `
    const ENUM_LIKE = { member: { a: 1 } as Record<string, number> };
    export const f = (k: string) => ENUM_LIKE.member[k];`,
  // A guarded lookup where the *lookup side* (not just the guard's table argument) is wrapped, e.g. a cast applied
  // after Object.hasOwn already narrowed. Same table/key as the guard, so this should be exempt like guardAs.
  guardAsWrappedTable: `
    const TABLE: Record<string, string> = {};
    export const f = (k: string) => (Object.hasOwn(TABLE, k) ? (TABLE as Record<string, string>)[k] : "x");`,
  // An unguarded optional-chain lookup must still be flagged; ChainExpression being added to TRANSPARENT (for the
  // guard's parent-walk) must not accidentally exempt this too.
  unguardedOptionalChain: `const TABLE: Record<string, string> = {}; export const f = (k: string) => TABLE?.[k];`,
});

test("#361's old registry lookups are flagged: the table index and the `in` check", () => {
  assert.deepEqual(found.metric361Registry.sort(), ["no-in-operator", "no-table-index"]);
});

test("#367's old mapNodeType lookup is flagged", () => {
  assert.deepEqual(found.nodeType367, ["no-table-index"]);
});

test("the fixed forms pass: Object.hasOwn, ownValue and a Map", () => {
  for (const name of ["metric361Fixed", "nodeType367Fixed", "nodeTypeOwnValue", "mapLookup"]) assert.deepEqual(found[name], [], name);
});

test("a literal key is allowed by design, including a literal prototype name", () => {
  for (const name of ["literalIn", "literalPrototypeIn", "literalIndex", "lowercaseTable"]) assert.deepEqual(found[name], [], name);
});

test("the recommended ternary passes only with a matching guard, the lookup in its true branch", () => {
  assert.deepEqual(found.guardAs, []);
  // An if statement isn't recognised: use ownValue there.
  for (const name of ["guardOtherKey", "guardOtherTable", "guardNegated", "guardElseBranch", "guardInIf"]) {
    assert.deepEqual(found[name], ["no-table-index"], name);
  }
});

test("a variable key is flagged, whatever its form", () => {
  assert.deepEqual(found.variableIn, ["no-in-operator"]);
  assert.deepEqual(found.templateKey, ["no-table-index"]);
  assert.deepEqual(found.memberKey, ["no-table-index"]);
});

// Two gaps the fresh-eyes pass found, now fixed in the plugin.
test("destructuring a computed key from a lookup table is flagged like TABLE[k]", () => {
  assert.deepEqual(found.destructureComputed, ["no-table-index"]);
  assert.deepEqual(found.destructureAssign, ["no-table-index"]);
  assert.deepEqual(found.destructureLiteral, []);
  assert.deepEqual(found.destructureLowercase, []);
});

test("the hasOwn-ternary guard is recognised when the lookup uses optional chaining", () => {
  assert.deepEqual(found.guardOptionalChain, []);
});

test("the optional-chain guard exemption stays as narrow as the non-chain guard", () => {
  for (const name of ["guardOtherKeyChain", "guardOtherTableChain", "guardElseBranchChain"]) {
    assert.deepEqual(found[name], ["no-table-index"], name);
  }
});

test("destructuring inside a for-of body is flagged like any other const destructure", () => {
  assert.deepEqual(found.destructureForOfBody, ["no-table-index"]);
});

// Found by the second fresh-eyes round, fixed in destructuredFrom (an AssignmentPattern parent).
test("a destructured computed key as a parameter default is flagged", () => {
  assert.deepEqual(found.destructureParamDefault, ["no-table-index"]);
});

test("a rest sibling doesn't hide the flagged computed key", () => {
  assert.deepEqual(found.destructureRestSibling, ["no-table-index"]);
});

test("a destructured parameter default is flagged on a function declaration, a class method, and an object method", () => {
  for (const name of ["destructureFunctionDeclDefault", "destructureMethodDefault", "destructureObjectMethodDefault"]) {
    assert.deepEqual(found[name], ["no-table-index"], name);
  }
});

test("a catch-bound identifier is checked by name like any other, since the rule isn't scope-aware", () => {
  assert.deepEqual(found.destructureCatchBinding, ["no-table-index"]);
});

// Found by the third fresh-eyes round, fixed with tableName(): a cast or non-null table (`TABLE as X`, `TABLE!`,
// `(TABLE)`) is still the table, in both forms.
test("a wrapped table is still flagged (destructuring form)", () => {
  assert.deepEqual(found.destructureAsExpressionSource, ["no-table-index"]);
});

test("a wrapped table is still flagged (plain TABLE[k] form)", () => {
  assert.deepEqual(found.memberAsExpressionSource, ["no-table-index"]);
});

test("an object literal (not a pattern) with a computed table-named key is not flagged", () => {
  assert.deepEqual(found.objectLiteralNotPattern, []);
});

test("a pattern's own default value mentioning the table doesn't flag when the destructuring source isn't the table", () => {
  assert.deepEqual(found.destructureDefaultValueIsTable, []);
});

// The MemberExpression selector dropped [object.type='Identifier'] (relying on tableName() instead); these confirm
// that non-table member accesses still aren't flagged.
test("a non-table object (this.X, obj.CONST, ENUM_LIKE.member) is not flagged even when a member name is ALL_CAPS", () => {
  for (const name of ["thisMember", "objectConstMember", "enumLikeMember"]) assert.deepEqual(found[name], [], name);
});

test("the hasOwn guard is recognised when the lookup side (not the guard's argument) is wrapped", () => {
  assert.deepEqual(found.guardAsWrappedTable, []);
});

test("an unguarded optional-chain lookup is still flagged", () => {
  assert.deepEqual(found.unguardedOptionalChain, ["no-table-index"]);
});
