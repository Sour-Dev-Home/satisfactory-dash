// The wiki log (ADR-0033): docs-vault/wiki/log.md is frozen history; every PR since adds ONE fragment
// file under docs-vault/wiki/log.d/, so two PRs never edit the same lines.
//
//   npm run log                 print log.md, then the fragments in file-name order
//   npm run log -- --compact    fold the fragments into the end of log.md and delete them
//                               (the coordinator does this in its own PR, labelled `log-compaction`)
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wikiDir = path.join(root, "docs-vault", "wiki");
export const LOG_FILE = path.join(wikiDir, "log.md");
export const FRAGMENT_DIR = path.join(wikiDir, "log.d");

/** A fragment is `<YYYY-MM-DD>-<slug>.md`. The README that explains the folder is not one. */
export const FRAGMENT_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/;

/** The fragments in `dir`, sorted by file name (so by date, then slug), with their trimmed text. */
export function readFragments(dir = FRAGMENT_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => FRAGMENT_NAME.test(name))
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf8").trim() }))
    .filter((fragment) => fragment.text.length > 0);
}

/** log.md, then each fragment's bullets, as one string that ends with a newline. */
export function assembleLog(logText, fragments) {
  const parts = [logText.replace(/\s+$/, ""), ...fragments.map((fragment) => fragment.text)];
  return `${parts.join("\n")}\n`;
}

/** Folds the fragments into log.md and deletes them; returns how many were folded. */
export function compact({ logFile = LOG_FILE, dir = FRAGMENT_DIR } = {}) {
  const fragments = readFragments(dir);
  if (fragments.length === 0) return 0;
  writeFileSync(logFile, assembleLog(readFileSync(logFile, "utf8"), fragments));
  for (const fragment of fragments) {
    unlinkSync(path.join(dir, fragment.name));
  }
  return fragments.length;
}

function main(args) {
  if (args.includes("--compact")) {
    const folded = compact();
    console.log(folded === 0 ? "No fragments to fold." : `Folded ${folded} fragment(s) into log.md and deleted them.`);
    return;
  }
  process.stdout.write(assembleLog(readFileSync(LOG_FILE, "utf8"), readFragments()));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
