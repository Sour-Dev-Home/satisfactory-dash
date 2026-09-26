// CI check for ADR-0033 (runs in the `verify` job, on pull_request events only): a PR adds exactly its own log
// fragment under docs-vault/wiki/log.d/ and never edits the frozen log.md or another PR's fragment.
//
// Inputs come from the environment (no untrusted text is ever put in a shell line):
//   PR_FILES_JSON  the PR's changed files as the GitHub API returns them: [{ filename, status, previous_filename? }]
//   PR_LABELS_JSON the PR's label names: ["..."]
//   PR_AUTHOR      the PR author's login
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOG_FILE = "docs-vault/wiki/log.md";
const FRAGMENT_DIR = "docs-vault/wiki/log.d/";
const FRAGMENT_README = `${FRAGMENT_DIR}README.md`;
const FRAGMENT_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/;

export const COMPACTION_LABEL = "log-compaction";
export const DEPENDABOT = "dependabot[bot]";

const isFragmentPath = (file) => file.startsWith(FRAGMENT_DIR) && file !== FRAGMENT_README;

/**
 * @param {{ files: { filename: string; status: string; previous_filename?: string }[]; labels: string[]; author: string }} pr
 * @returns {{ ok: boolean; exempt?: string; problems: string[] }}
 */
export function checkLogFragments({ files, labels, author }) {
  if (author === DEPENDABOT) return { ok: true, exempt: "Dependabot", problems: [] };
  if (labels.includes(COMPACTION_LABEL)) return { ok: true, exempt: `label ${COMPACTION_LABEL}`, problems: [] };

  const problems = [];
  const added = [];
  for (const { filename, status, previous_filename: previous } of files) {
    // A rename touches the old path too: moving a fragment out of log.d/ (or log.md away) is an edit of history.
    const touched = [filename, ...(previous ? [previous] : [])];
    if (touched.includes(LOG_FILE)) {
      problems.push(
        `${LOG_FILE} is frozen (ADR-0033) and this PR changes it. Revert that change and put your entry in a new ` +
          `file ${FRAGMENT_DIR}<YYYY-MM-DD>-<branch-slug>.md instead.`,
      );
    }
    const fragmentTouched = touched.filter(isFragmentPath);
    if (fragmentTouched.length === 0) continue;
    if (status === "added" && !previous) {
      added.push(filename);
    } else {
      problems.push(
        `${fragmentTouched.join(", ")} already exists on main and this PR changes it (status: ${status}). Fragments are ` +
          `one per PR and never edited afterwards: revert this change and add your own new file in ${FRAGMENT_DIR}.`,
      );
    }
  }

  for (const filename of added) {
    if (!FRAGMENT_NAME.test(path.posix.basename(filename)) || filename !== `${FRAGMENT_DIR}${path.posix.basename(filename)}`) {
      problems.push(
        `${filename} is not a valid fragment name. Use ${FRAGMENT_DIR}<YYYY-MM-DD>-<branch-slug>.md ` +
          `(lowercase letters, digits and hyphens in the slug, directly inside log.d/).`,
      );
    }
  }
  if (added.length === 0) {
    problems.push(
      `This PR adds no log fragment. Add one file ${FRAGMENT_DIR}<YYYY-MM-DD>-<branch-slug>.md with one or more bullets ` +
        `describing the change, in the style of log.md (see ${FRAGMENT_README}).`,
    );
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

function main() {
  const parse = (name) => {
    try {
      return JSON.parse(process.env[name] ?? "");
    } catch {
      console.error(`::error::${name} is missing or not JSON; the log check cannot run.`);
      process.exit(1);
    }
  };
  const result = checkLogFragments({
    files: parse("PR_FILES_JSON"),
    labels: parse("PR_LABELS_JSON"),
    author: process.env.PR_AUTHOR ?? "",
  });
  if (!result.ok) {
    for (const problem of result.problems) console.error(`::error::${problem}`);
    process.exit(1);
  }
  console.log(result.exempt ? `Log fragment check skipped (${result.exempt}).` : "Log fragment check passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
