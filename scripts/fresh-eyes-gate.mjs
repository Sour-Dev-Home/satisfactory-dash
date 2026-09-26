// The merge queue's fresh-eyes gate (ADR-0033). The `main` ruleset requires the commit status
// `fresh-eyes/test-hunter`, which a review session posts on a PR's HEAD sha. The merge queue tests a NEW commit
// (main plus the queued PRs), which has no such status, so this script carries it over: it finds the PR the queue
// entry is for, reads that PR head's status, and posts the same context on the merge group's commit, but only
// when the PR head really has a success. Anything it cannot establish is a failure (fail closed).
//
// Run by .github/workflows/fresh-eyes-gate.yml on `merge_group`. Everything comes in through the environment:
//   REPO        owner/name
//   HEAD_REF    github.event.merge_group.head_ref   (gh-readonly-queue/main/pr-<N>-<sha>)
//   GROUP_SHA   github.event.merge_group.head_sha   (the commit the queue is testing)
//   GH_TOKEN    the workflow token (statuses: write, pull-requests: read, contents: read)
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONTEXT = "fresh-eyes/test-hunter";

const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// The queue names its temporary branch gh-readonly-queue/<base>/pr-<number>-<sha>. Only `main` is served, and
// anything that does not match exactly is refused rather than guessed at.
const QUEUE_REF = /^gh-readonly-queue\/main\/pr-([1-9][0-9]{0,8})-[0-9a-f]{40}$/;

/** The PR number a merge group's head ref belongs to, or null when the ref is not exactly the queue's format. */
export function parsePrNumber(headRef) {
  if (typeof headRef !== "string") return null;
  const match = QUEUE_REF.exec(headRef);
  return match ? Number(match[1]) : null;
}

/**
 * What to post on the merge group's commit, given the PR head's statuses (the combined-status list, which holds the
 * latest status per context; if a context appears twice the most recently updated one wins).
 * @param {{ prHeadSha: unknown, statuses: unknown }} input
 * @returns {{ state: "success" | "failure", description: string }}
 */
export function decide({ prHeadSha, statuses }) {
  if (typeof prHeadSha !== "string" || !SHA.test(prHeadSha)) {
    return { state: "failure", description: "no fresh-eyes success on PR head (PR head sha unknown)" };
  }
  const mine = (Array.isArray(statuses) ? statuses : [])
    .filter((status) => status !== null && typeof status === "object" && status.context === CONTEXT)
    .sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")));
  if (mine[0]?.state === "success") {
    return { state: "success", description: `carried from ${prHeadSha.slice(0, 7)}` };
  }
  return { state: "failure", description: "no fresh-eyes success on PR head" };
}

function ghApi(args) {
  // execFile, never a shell: nothing here is ever interpreted as a command line.
  return execFileSync("gh", ["api", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Posts a status on `sha`. `api` is injectable for tests. */
export function postStatus({ repo, sha, state, description }, api = ghApi) {
  api([
    `repos/${repo}/statuses/${sha}`,
    "-f", `state=${state}`,
    "-f", `context=${CONTEXT}`,
    "-f", `description=${description.slice(0, 140)}`,
  ]);
}

/** The whole gate. Returns what it posted; throws (so the job fails) when it cannot even post. */
export function runGate({ repo, headRef, groupSha }, api = ghApi) {
  if (!REPO.test(repo ?? "") || !SHA.test(groupSha ?? "")) {
    throw new Error("REPO or GROUP_SHA is missing or malformed; the gate cannot run");
  }
  const post = (decision) => {
    postStatus({ repo, sha: groupSha, ...decision }, api);
    return decision;
  };
  const number = parsePrNumber(headRef);
  if (number === null) {
    return post({ state: "failure", description: "cannot tell which PR this queue entry is for" });
  }
  let decision;
  try {
    const pr = JSON.parse(api([`repos/${repo}/pulls/${number}`]));
    const prHeadSha = pr?.head?.sha;
    if (typeof prHeadSha !== "string" || !SHA.test(prHeadSha)) {
      decision = { state: "failure", description: "no fresh-eyes success on PR head (PR head sha unknown)" };
    } else {
      // The combined-status list is paginated (30 per page by default), so a commit with many contexts could hide
      // ours. Ask for 100 per page and keep reading until a short page.
      const statuses = [];
      for (let page = 1; page <= 10; page++) {
        const combined = JSON.parse(api([`repos/${repo}/commits/${prHeadSha}/status?per_page=100&page=${page}`]));
        const batch = Array.isArray(combined?.statuses) ? combined.statuses : [];
        statuses.push(...batch);
        if (batch.length < 100) break;
      }
      decision = decide({ prHeadSha, statuses });
    }
  } catch {
    decision = { state: "failure", description: "could not read the PR's fresh-eyes status" };
  }
  return post(decision);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runGate({ repo: process.env.REPO, headRef: process.env.HEAD_REF, groupSha: process.env.GROUP_SHA });
  console.log(`fresh-eyes gate: ${result.state} (${result.description})`);
  if (result.state !== "success") {
    process.exit(1);
  }
}
