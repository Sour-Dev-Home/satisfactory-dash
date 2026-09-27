import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { formatReport, median, parseRun, readRuns, RUN_NAME, summarise, template } from "./hunter-report.mjs";

const fragment = (fields = {}) =>
  Object.entries({ pr: 1, tier: "QUICK", area: "frontend", minutes: 2, tokens: 30000, bugs: 0, fixed: 0, tests: 1, rounds: 1, ...fields })
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");

const run = (fields = {}) => parseRun(fragment(fields));

test("fragment names are a date and a PR number, with an optional counter", () => {
  assert.ok(RUN_NAME.test("2026-09-27-327.md"));
  assert.ok(RUN_NAME.test("2026-09-27-327-2.md"));
  assert.ok(!RUN_NAME.test("README.md"));
  assert.ok(!RUN_NAME.test("2026-09-27-stale-chunk.md"));
});

test("parseRun reads every field, with CRLF line ends and extra text", () => {
  const text = `Notes above are fine.\r\n${fragment({ pr: 327, tier: "FULL", tokens: 131567, bugs: 1, fixed: 1 }).replaceAll("\n", "\r\n")}\r\n`;
  assert.deepEqual(parseRun(text), {
    pr: 327,
    minutes: 2,
    tokens: 131567,
    bugs: 1,
    fixed: 1,
    tests: 1,
    rounds: 1,
    tier: "FULL",
    area: "frontend",
  });
});

test("parseRun names the file and field on bad input", () => {
  assert.throws(() => parseRun(fragment().replace("- tokens: 30000\n", ""), "x.md"), /x\.md: "tokens" must be a number/);
  assert.throws(() => parseRun(fragment({ bugs: "some" }), "x.md"), /"bugs" must be a number of 0 or more \(got some\)/);
  assert.throws(() => parseRun(fragment({ tests: -1 })), /"tests" must be a number/);
  assert.throws(() => parseRun(fragment({ tier: "full" })), /"tier" must be one of FULL, QUICK/);
  assert.throws(() => parseRun(fragment({ area: "docs" })), /"area" must be one of/);
  assert.throws(() => parseRun(fragment({ bugs: 1, fixed: 2 })), /"fixed" \(2\) is more than "bugs" \(1\)/);
  assert.throws(() => parseRun(fragment({ rounds: 0 })), /"rounds" must be at least 1/);
});

// Found by the fresh-eyes pass: Number() read an empty value as 0 and "0x10" as 16.
test("an empty value fails loudly instead of reading as 0", () => {
  for (const blank of ["- bugs:    ", "- bugs:"]) {
    assert.throws(
      () => parseRun(fragment().replace("- bugs: 0", blank), "blank.md"),
      /blank\.md: "bugs" must be a number of 0 or more \(got nothing\)/,
    );
  }
  assert.throws(() => parseRun(fragment().replace("- tier: QUICK", "- tier:")), /"tier" must be one of FULL, QUICK \(got nothing\)/);
});

test("numbers are plain decimals: hex, octal, binary, exponents and signs are refused", () => {
  for (const bad of ["0x10", "0b101", "0o17", "1e3", "+5", " 1 2", "Infinity", "1."]) {
    assert.throws(() => parseRun(fragment({ tokens: bad }), "x.md"), /"tokens" must be a number/, `accepted "${bad}"`);
  }
  assert.equal(parseRun(fragment({ minutes: "10.1" })).minutes, 10.1);
  assert.equal(parseRun(fragment({ tokens: "007" })).tokens, 7);
});

test("a repeated key is an error, since which value is right can't be known", () => {
  assert.throws(() => parseRun(`${fragment({ bugs: 0 })}\n- bugs: 5`, "dup.md"), /dup\.md: "bugs" appears more than once/);
});

test("a repeated key still errors even when it isn't one of the known fields", () => {
  assert.throws(
    () => parseRun(`${fragment()}\n- note: hi\n- note: bye`, "dup-note.md"),
    /dup-note\.md: "note" appears more than once/,
  );
});

test("fixed equal to bugs, and rounds equal to 1, are the allowed boundary, not an error", () => {
  assert.equal(run({ bugs: 3, fixed: 3 }).fixed, 3);
  assert.equal(run({ rounds: 1 }).rounds, 1);
  assert.throws(() => parseRun(fragment({ rounds: "0.99" })), /"rounds" must be at least 1/);
});

test("a bullet indented with leading whitespace isn't recognised as a field line", () => {
  // The format is `- key: value` starting at column 0; an indented "  - pr: 1" is
  // ordinary ignored text, so the field reads as missing, not as a parse of "1".
  assert.throws(
    () => parseRun(fragment().replace("- pr: 1", "  - pr: 1"), "indent.md"),
    /indent\.md: "pr" must be a number of 0 or more \(got nothing\)/,
  );
});

test("formatReport renders a single row's numbers correctly, including a non-exact 0-bug share", () => {
  const rows = [
    run({ tier: "FULL", area: "backend", tokens: 100, minutes: 1, bugs: 0 }),
    run({ tier: "FULL", area: "backend", tokens: 100, minutes: 1, bugs: 0 }),
    run({ tier: "FULL", area: "backend", tokens: 100, minutes: 1, bugs: 1 }),
  ];
  const report = formatReport(rows);
  assert.match(report, /^3 hunter run\(s\)$/m);
  assert.match(report, /^FULL {3}backend {10}3 {12}100 {9}1\.0 {6}0\.33 {10}67%$/m);
  assert.doesNotMatch(report, /Downgrade candidates/);
});

test("the template parses once filled in", () => {
  const filled = template()
    .replace("<number>", "5")
    .replace(/<FULL[^>]*>/, "FULL")
    .replace(/<backend[^>]*>/, "backend")
    .replace(/<[^>]*>/g, "1");
  assert.equal(parseRun(filled).tier, "FULL");
});

test("median of odd, even and empty lists", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
});

test("summarise groups by tier and area, FULL first", () => {
  const rows = summarise([
    run({ tier: "QUICK", area: "frontend", tokens: 10, bugs: 0 }),
    run({ tier: "FULL", area: "backend", tokens: 100, bugs: 2, fixed: 2 }),
    run({ tier: "FULL", area: "backend", tokens: 300, bugs: 0 }),
    run({ tier: "QUICK", area: "frontend", tokens: 30, bugs: 1, fixed: 1 }),
  ]);
  assert.deepEqual(
    rows.map((row) => [row.tier, row.area, row.runs, row.medianTokens, row.bugsPerRun, row.zeroBugShare, row.downgrade]),
    [
      ["FULL", "backend", 2, 200, 1, 0.5, false],
      ["QUICK", "frontend", 2, 20, 0.5, 0.5, false],
    ],
  );
});

test("a tier and area with no real bug in 8 runs is a downgrade candidate, 7 is not", () => {
  const quiet = (n) => Array.from({ length: n }, () => run({ tier: "QUICK", area: "shared" }));
  assert.equal(summarise(quiet(7))[0].downgrade, false);
  assert.equal(summarise(quiet(8))[0].downgrade, true);
  assert.equal(summarise([...quiet(8), run({ tier: "QUICK", area: "shared", bugs: 1 })])[0].downgrade, false);
  assert.match(formatReport(quiet(8)), /Downgrade candidates[^\n]*\n {2}QUICK shared: 8 runs/);
});

test("formatReport says when nothing is logged", () => {
  assert.match(formatReport([]), /No hunter runs logged yet/);
});

test("readRuns reads only fragments, in name order, and a bad one fails loudly", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hunter-log-test-"));
  try {
    writeFileSync(path.join(dir, "README.md"), "explains the folder");
    writeFileSync(path.join(dir, "2026-09-28-9.md"), fragment({ pr: 9 }));
    writeFileSync(path.join(dir, "2026-09-27-12.md"), fragment({ pr: 12 }));
    assert.deepEqual(
      readRuns(dir).map((r) => [r.name, r.pr]),
      [
        ["2026-09-27-12.md", 12],
        ["2026-09-28-9.md", 9],
      ],
    );
    writeFileSync(path.join(dir, "2026-09-29-3.md"), "- pr: 3");
    assert.throws(() => readRuns(dir), /2026-09-29-3\.md: "minutes"/);
  } finally {
    rmSync(dir, { recursive: true });
  }
  assert.deepEqual(readRuns(path.join(tmpdir(), "no-such-hunter-log")), []);
});
