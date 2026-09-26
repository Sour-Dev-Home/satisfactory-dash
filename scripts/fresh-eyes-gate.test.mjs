import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTEXT, decide, parsePrNumber, postStatus, runGate } from "./fresh-eyes-gate.mjs";

const HEAD = "a".repeat(40);
const GROUP = "b".repeat(40);
const REPO = "owner/repo";
const ref = (n, sha = GROUP) => `gh-readonly-queue/main/pr-${n}-${sha}`;

test("parsePrNumber reads the queue's branch format", () => {
  assert.equal(parsePrNumber(ref(176)), 176);
  assert.equal(parsePrNumber(ref(1)), 1);
  assert.equal(parsePrNumber(ref(123456789)), 123456789);
});

test("parsePrNumber refuses anything that is not exactly that format (fail closed)", () => {
  for (const bad of [
    "",
    "main",
    "refs/heads/main",
    `gh-readonly-queue/main/pr-0-${GROUP}`, // no PR 0, no leading zero
    `gh-readonly-queue/main/pr-01-${GROUP}`,
    `gh-readonly-queue/main/pr--5-${GROUP}`,
    `gh-readonly-queue/main/pr-abc-${GROUP}`,
    `gh-readonly-queue/main/pr-12-${"b".repeat(39)}`, // short sha
    `gh-readonly-queue/main/pr-12-${"B".repeat(40)}`, // not lowercase hex
    `gh-readonly-queue/develop/pr-12-${GROUP}`, // not the main queue
    `gh-readonly-queue/main/x/pr-12-${GROUP}`,
    `xgh-readonly-queue/main/pr-12-${GROUP}`,
    `gh-readonly-queue/main/pr-12-${GROUP}/extra`,
    `gh-readonly-queue/main/pr-1234567890-${GROUP}`, // more than 9 digits
    `gh-readonly-queue/main/pr-12-${GROUP}\n`,
    undefined,
    null,
    42,
    { toString: () => ref(1) },
  ]) {
    assert.equal(parsePrNumber(bad), null, JSON.stringify(bad));
  }
});

test("decide carries a success and names the PR head it came from", () => {
  const result = decide({ prHeadSha: HEAD, statuses: [{ context: CONTEXT, state: "success", updated_at: "2026-09-25T10:00:00Z" }] });
  assert.deepEqual(result, { state: "success", description: "carried from aaaaaaa" });
});

test("decide fails without a success: failure, pending, error, missing, other contexts", () => {
  for (const statuses of [
    [{ context: CONTEXT, state: "failure" }],
    [{ context: CONTEXT, state: "pending" }],
    [{ context: CONTEXT, state: "error" }],
    [{ context: "ci/other", state: "success" }],
    [{ context: `${CONTEXT}-not`, state: "success" }],
    [],
    undefined,
    null,
    "success",
    [null, 3, "x"],
  ]) {
    const result = decide({ prHeadSha: HEAD, statuses });
    assert.equal(result.state, "failure", JSON.stringify(statuses));
    assert.equal(result.description, "no fresh-eyes success on PR head");
  }
});

test("decide uses the most recently updated status of the context", () => {
  const older = { context: CONTEXT, state: "success", updated_at: "2026-09-25T10:00:00Z" };
  const newer = { context: CONTEXT, state: "failure", updated_at: "2026-09-25T11:00:00Z" };
  assert.equal(decide({ prHeadSha: HEAD, statuses: [older, newer] }).state, "failure");
  assert.equal(decide({ prHeadSha: HEAD, statuses: [newer, older] }).state, "failure");
  const newerSuccess = { ...older, updated_at: "2026-09-25T12:00:00Z" };
  assert.equal(decide({ prHeadSha: HEAD, statuses: [newer, newerSuccess] }).state, "success");
});

test("decide fails when the PR head sha is unknown or malformed", () => {
  const statuses = [{ context: CONTEXT, state: "success" }];
  for (const prHeadSha of [undefined, null, "", "abc", "A".repeat(40), 5]) {
    assert.equal(decide({ prHeadSha, statuses }).state, "failure");
  }
});

/** A fake `gh api` that records calls and answers the two reads. */
function fakeApi({ pr = { head: { sha: HEAD } }, statuses = [{ context: CONTEXT, state: "success" }], failReads = false } = {}) {
  const calls = [];
  const api = (args) => {
    calls.push(args);
    const url = args[0];
    if (url.startsWith(`repos/${REPO}/statuses/`)) return "{}";
    if (failReads) throw new Error("boom");
    if (url === `repos/${REPO}/pulls/176`) return JSON.stringify(pr);
    const m = /^repos\/owner\/repo\/commits\/a{40}\/status\?per_page=(\d+)&page=(\d+)$/.exec(url);
    if (m) {
      const size = Number(m[1]);
      assert.equal(size, 100, "must request the maximum page size");
      const page = Number(m[2]);
      return JSON.stringify({ total_count: statuses.length, statuses: statuses.slice((page - 1) * size, page * size) });
    }
    throw new Error(`unexpected read ${url}`);
  };
  return { api, calls };
}
const posts = (calls) => calls.filter((args) => args[0].includes("/statuses/"));

test("runGate posts success on the merge group's commit when the PR head has a success", () => {
  const { api, calls } = fakeApi();
  const result = runGate({ repo: REPO, headRef: ref(176), groupSha: GROUP }, api);
  assert.equal(result.state, "success");
  const [post] = posts(calls);
  assert.equal(post[0], `repos/${REPO}/statuses/${GROUP}`);
  assert.deepEqual(post.slice(1), ["-f", "state=success", "-f", `context=${CONTEXT}`, "-f", "description=carried from aaaaaaa"]);
  assert.equal(posts(calls).length, 1);
});

test("runGate posts failure, never success, when the PR head has none", () => {
  for (const statuses of [[], [{ context: CONTEXT, state: "pending" }], [{ context: CONTEXT, state: "failure" }]]) {
    const { api, calls } = fakeApi({ statuses });
    assert.equal(runGate({ repo: REPO, headRef: ref(176), groupSha: GROUP }, api).state, "failure");
    assert.ok(posts(calls)[0].includes("state=failure"));
  }
});

test("runGate fails closed when the branch name does not parse: posts failure and reads nothing", () => {
  const { api, calls } = fakeApi();
  const result = runGate({ repo: REPO, headRef: "refs/heads/main", groupSha: GROUP }, api);
  assert.equal(result.state, "failure");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("state=failure"));
});

test("runGate finds the context even when it is beyond the first page of a many-status commit", () => {
  const filler = Array.from({ length: 130 }, (_, i) => ({ context: `ci/filler-${i}`, state: "success" }));
  const { api, calls } = fakeApi({ statuses: [...filler, { context: CONTEXT, state: "success" }] });
  assert.equal(runGate({ repo: REPO, headRef: ref(176), groupSha: GROUP }, api).state, "success");
  assert.ok(posts(calls)[0].includes("state=success"));
});

test("runGate fails closed when the API reads fail or return junk", () => {
  assert.equal(runGate({ repo: REPO, headRef: ref(176), groupSha: GROUP }, fakeApi({ failReads: true }).api).state, "failure");
  assert.equal(runGate({ repo: REPO, headRef: ref(176), groupSha: GROUP }, fakeApi({ pr: { head: {} } }).api).state, "failure");
  assert.equal(runGate({ repo: REPO, headRef: ref(176), groupSha: GROUP }, fakeApi({ pr: null }).api).state, "failure");
});

test("runGate refuses to run with a malformed repo or group sha, and posts nothing", () => {
  const { api, calls } = fakeApi();
  for (const input of [
    { repo: "no-slash", headRef: ref(176), groupSha: GROUP },
    { repo: "a/b/c", headRef: ref(176), groupSha: GROUP },
    { repo: "a/b; rm -rf", headRef: ref(176), groupSha: GROUP },
    { repo: REPO, headRef: ref(176), groupSha: "abc" },
    { repo: undefined, headRef: ref(176), groupSha: GROUP },
    { repo: REPO, headRef: ref(176), groupSha: undefined },
  ]) {
    assert.throws(() => runGate(input, api));
  }
  assert.equal(calls.length, 0);
});

test("postStatus keeps the description within GitHub's 140 characters", () => {
  const calls = [];
  postStatus({ repo: REPO, sha: GROUP, state: "failure", description: "x".repeat(300) }, (args) => calls.push(args));
  assert.equal(calls[0].find((arg) => arg.startsWith("description=")).length, "description=".length + 140);
});
