// Applied migrations never change (#561, OWASP A08). node-pg-migrate records each file by name once it has run, so an
// edit to one that production already applied never runs there, and the schema in git quietly stops matching the
// database. A fix is always a new migration. Pull requests only: CI passes the PR's files as JSON, like log-check.mjs.
//
//   PR_FILES_JSON='[{"filename":"…","status":"modified"}]' node scripts/migration-immutable.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = "backend/migrations/";

/** The problems with a PR's file list: any existing migration modified, removed or renamed. */
export function checkMigrationFiles(files) {
  const problems = [];
  for (const f of files) {
    const inDir = (p) => typeof p === "string" && p.startsWith(DIR);
    if (f.status === "added") continue;
    if (f.status === "renamed") {
      if (inDir(f.previous_filename)) problems.push(`${f.previous_filename} was renamed to ${f.filename}`);
      else if (inDir(f.filename)) problems.push(`${f.filename} was renamed from outside ${DIR}; add it as a new file instead`);
      continue;
    }
    if (inDir(f.filename)) problems.push(`${f.filename} was ${f.status}`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = JSON.parse(process.env.PR_FILES_JSON ?? "[]");
  const problems = checkMigrationFiles(files);
  for (const p of problems) console.error(`::error::${p}`);
  if (problems.length) {
    console.error("An applied migration never changes: production has already run it by name. Write a new migration instead.");
    process.exit(1);
  }
  console.log(`migration-immutable: ${files.length} files, no existing migration changed`);
}
