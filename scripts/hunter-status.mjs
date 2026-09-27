// The fresh-eyes/test-hunter status, tied to a fingerprint of the PR's own changes (#340), so a rebase or a merge
// from main keeps it instead of costing another hunter run.
//
// The fingerprint (fp) is `git patch-id --verbatim` of the diff from the merge-base with main to the PR head, cut to
// 12 hex. --verbatim, not --stable: plain patch-id drops ALL whitespace, so `y - -z` and `y --z` would match.
// --binary so two different binary edits don't both read "Binary files differ"; --no-renames so rename detection
// can't vary. A clean rebase or merge from main keeps the fp; a merge that resolved a conflict changes it.
//
//   npm run hunter-status -- "<summary>"   (a session, after a hunter pass) posts "<summary> fp:<fp>" on HEAD
//   node scripts/hunter-status.mjs reuse   (.github/workflows/fresh-eyes-reuse.yml) re-posts it on a new head
//
// Reuse trusts ONLY a success created by the owner's account. A reuse posted by the workflow names that original's
// full sha, and the original is re-checked (one hop): any workflow with statuses: write posts as
// github-actions[bot], including one a PR adds, so the bot's login alone proves nothing.
import { execFileSync } from "node:child_process";
import { devNull } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTEXT } from "./fresh-eyes-gate.mjs";

/** The account whose hunter results count (LEGAL.md names it). */
export const OWNER_LOGIN = "SourE-dev";
export const BOT_LOGIN = "github-actions[bot]";

const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PR_NUMBER = /^[1-9][0-9]{0,8}$/;
const FP_AT_END = /(?:^|\s)fp:([0-9a-f]{12})$/;
const REUSED = /^reused from ([0-9a-f]{40}), fp:([0-9a-f]{12})$/;
const MAX_DESCRIPTION = 140;

function run(command, args, input) {
  // execFile, never a shell: nothing here is ever interpreted as a command line.
  return execFileSync(command, args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
}

/**
 * `git` with nothing taken from outside the command: no global or system attributes file, and the diff options
 * below turn off external diff drivers and textconv.
 */
const git = (args, input) => run("git", ["-c", `core.attributesFile=${devNull}`, ...args], input);

/** The PR's own changes as 12 hex, or throws. `gitRun` is injectable for tests. */
export function fingerprint({ base, head }, gitRun = git) {
  const mergeBase = gitRun(["merge-base", base, head]).trim();
  if (!SHA.test(mergeBase)) throw new Error(`no merge-base between ${base} and ${head}`);
  // Default context (3 lines), on purpose: patch-id ignores line numbers, so with -U0 the same line added in another
  // function would keep the fp. The cost is a re-run when main edits a line next to the PR's (see the tests).
  const diff = gitRun(["diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color", mergeBase, head]);
  if (diff.trim() === "") throw new Error("the PR has no changes of its own");
  const patchId = gitRun(["patch-id", "--verbatim"], diff).trim().split(/\s+/)[0] ?? "";
  if (!SHA.test(patchId)) throw new Error("git patch-id gave no id");
  return patchId.slice(0, 12);
}

/** The newest status for the fresh-eyes context in a commit's status list, or null. */
export function latestStatus(statuses) {
  const mine = (Array.isArray(statuses) ? statuses : []).filter(
    (status) => status !== null && typeof status === "object" && status.context === CONTEXT,
  );
  mine.sort(
    (a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) || Number(b.id ?? 0) - Number(a.id ?? 0),
  );
  return mine[0] ?? null;
}

/** The fp of an owner-created success, or null. */
function ownerFp(status) {
  if (status?.state !== "success" || status?.creator?.login !== OWNER_LOGIN) return null;
  return FP_AT_END.exec(String(status.description ?? ""))?.[1] ?? null;
}

/**
 * Whether the new head may reuse the previous head's result, and what to post if so.
 * @param {{ newFp: string, beforeSha: string, statusOf: (sha: string) => object | null }} input
 *   statusOf returns a commit's newest fresh-eyes status (latestStatus of its list).
 * @returns {{ reuse: true, description: string } | { reuse: false, reason: string }}
 */
export function decideReuse({ newFp, beforeSha, statusOf }) {
  const before = statusOf(beforeSha);
  if (!before) return { reuse: false, reason: "the previous head has no fresh-eyes status" };
  if (before.state !== "success") return { reuse: false, reason: `the previous head's status is ${before.state}` };

  let original;
  let fp;
  if (before.creator?.login === OWNER_LOGIN) {
    original = beforeSha;
    fp = ownerFp(before);
    if (!fp) return { reuse: false, reason: "the previous head's status has no fp" };
  } else if (before.creator?.login === BOT_LOGIN) {
    const named = REUSED.exec(String(before.description ?? ""));
    if (!named) return { reuse: false, reason: "the previous head's bot status doesn't name an original" };
    [, original, fp] = named;
    if (ownerFp(statusOf(original)) !== fp) {
      return { reuse: false, reason: `the named original ${original.slice(0, 7)} has no matching owner success` };
    }
  } else {
    return { reuse: false, reason: `the previous head's status was posted by ${before.creator?.login ?? "nobody"}` };
  }

  if (fp !== newFp) return { reuse: false, reason: `the PR's changes differ (fp ${fp} -> ${newFp})` };
  return { reuse: true, description: `reused from ${original}, fp:${fp}` };
}

/** The status text a session posts: its summary, then the fp; throws if it can't fit. */
export function sessionDescription(summary, fp) {
  const text = `${String(summary).trim()} fp:${fp}`;
  if (String(summary).trim() === "") throw new Error("give a one-line summary, e.g. \"QUICK: 0 bugs, 2 tests\"");
  if (text.length > MAX_DESCRIPTION) {
    throw new Error(`the summary is too long: ${text.length} characters with the fp, GitHub allows ${MAX_DESCRIPTION}`);
  }
  return text;
}

const ghApi = (args) => run("gh", ["api", ...args]);

/** A commit's newest fresh-eyes status (the list endpoint, which names each status's creator). */
export function fetchStatus({ repo, sha }, api = ghApi) {
  const statuses = [];
  for (let page = 1; page <= 10; page++) {
    const batch = JSON.parse(api([`repos/${repo}/commits/${sha}/statuses?per_page=100&page=${page}`]));
    if (!Array.isArray(batch)) break;
    statuses.push(...batch);
    if (batch.length < 100) break;
  }
  return latestStatus(statuses);
}

function postStatus({ repo, sha, description }, api = ghApi) {
  api([`repos/${repo}/statuses/${sha}`, "-f", "state=success", "-f", `context=${CONTEXT}`, "-f", `description=${description}`]);
}

/** The workflow's job. Posts only on a reuse; everything else leaves the head without a status. */
export function runReuse(env, { api = ghApi, gitRun = git } = {}) {
  const { REPO: repo, PR_NUMBER: number, BEFORE: before, AFTER: after, BASE_SHA: base } = env;
  if (!REPO.test(repo ?? "") || !PR_NUMBER.test(number ?? "") || ![before, after, base].every((sha) => SHA.test(sha ?? ""))) {
    throw new Error("REPO, PR_NUMBER, BEFORE, AFTER or BASE_SHA is missing or malformed");
  }
  // Objects only: the head is never checked out, and no tag comes with it.
  gitRun(["fetch", "--no-tags", "--quiet", "origin", `+refs/pull/${number}/head:refs/remotes/pr/head`]);
  const fetched = gitRun(["rev-parse", "refs/remotes/pr/head"]).trim();
  if (fetched !== after) return { reuse: false, reason: `the PR head moved on (${fetched.slice(0, 7)}, not ${after.slice(0, 7)})` };
  const newFp = fingerprint({ base, head: after }, gitRun);
  const decision = decideReuse({ newFp, beforeSha: before, statusOf: (sha) => fetchStatus({ repo, sha }, api) });
  if (decision.reuse) postStatus({ repo, sha: after, description: decision.description }, api);
  return decision;
}

/** A session's post, on its own pushed PR head. */
export function runPost(summary, { api = ghApi, gitRun = git, gh = (args) => run("gh", args) } = {}) {
  if (gitRun(["status", "--porcelain"]).trim() !== "") throw new Error("commit or discard your changes first");
  const head = gitRun(["rev-parse", "HEAD"]).trim();
  const pr = JSON.parse(gh(["pr", "view", "--json", "headRefOid,state"]));
  if (pr.state !== "OPEN") throw new Error("this branch's PR isn't open");
  if (pr.headRefOid !== head) throw new Error(`HEAD ${head.slice(0, 7)} isn't the PR's head ${String(pr.headRefOid).slice(0, 7)}: push first`);
  gitRun(["fetch", "--no-tags", "--quiet", "origin", "main"]);
  const description = sessionDescription(summary, fingerprint({ base: "origin/main", head }, gitRun));
  const repo = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
  postStatus({ repo, sha: head, description }, api);
  return { sha: head, description };
}

function main(args) {
  if (args[0] === "reuse") {
    const decision = runReuse(process.env);
    console.log(decision.reuse ? `fresh-eyes reuse: posted "${decision.description}"` : `fresh-eyes reuse: not reused (${decision.reason})`);
    return;
  }
  const { sha, description } = runPost(args.join(" "));
  console.log(`posted ${CONTEXT} on ${sha.slice(0, 7)}: ${description}`);
  console.log("Now log the run: docs-vault/wiki/hunter-log.d/<date>-<pr>.md (npm run hunter-report -- --template).");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`hunter-status: ${error.message}`);
    process.exitCode = 1;
  }
}
