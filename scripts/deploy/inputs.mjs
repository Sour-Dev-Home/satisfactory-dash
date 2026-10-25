// The backend images' build inputs (ADR-0054 D1): one hash over the git tree ids of exactly what backend/Dockerfile
// builds from. "Backend images" stamps it on both images as the `dev.satis-manager.inputs` label; the release record
// keeps it; an automatic deploy whose newest images carry production's hash has nothing deployable to ship.
//
//   node scripts/deploy/inputs.mjs [<rev>]     prints the hash for a commit (default HEAD)
//
// A false skip (a real change not deployed) is the failure to avoid, so: every path the Dockerfile copies is in
// INPUT_PATHS (inputs.test.mjs parses the Dockerfile's COPY lines), a required path that is missing fails instead of
// hashing less, and a record or image without a valid hash never matches (lib.mjs alreadyReleased).
//
// Not covered, accepted: the ops stage's apt-get packages are not pinned, so a rebuild that only picks up newer ones
// is skipped; they ship with the next real change (a base-digest bump is one) or a dispatched deploy.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const INPUTS_LABEL = "dev.satis-manager.inputs";

/**
 * What the build context of backend/Dockerfile (context `.`) contributes. `backend` holds the Dockerfile, its
 * ignore file (backend/Dockerfile.dockerignore, which BuildKit prefers), the migrations and the CA bundle. A root
 * `.dockerignore` is not used today; it is hashed as absent, so adding one changes the hash.
 */
export const INPUT_PATHS = [
  { path: "backend", required: true },
  { path: "packages/shared", required: true },
  { path: "packages/game-adapter", required: true },
  { path: "package.json", required: true },
  { path: "package-lock.json", required: true },
  { path: ".dockerignore", required: false },
  // The build's settings (target, platforms, labels, build-push version, any future build-args) live here, not in
  // the Dockerfile (fresh-eyes and security review).
  { path: ".github/workflows/image.yml", required: true },
];

// Bumped if the way the hash is formed ever changes, so an old hash can never equal a new one by accident.
const VERSION = "satis-inputs-v1";

const HASH = /^[0-9a-f]{64}$/;
export const isInputs = (s) => typeof s === "string" && HASH.test(s);

/**
 * The hash from `git ls-tree -z <rev> -- <paths>` output: each entry is `<mode> <type> <id>\t<path>`, and the mode
 * and type are hashed with the id (a file turning executable is a change too). Throws when a required path is
 * absent or an entry is not what git prints.
 */
export function inputsHash(lsTree) {
  const entries = new Map();
  for (const rec of lsTree.split("\0")) {
    if (!rec) continue;
    const m = rec.match(/^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/s);
    if (!m) throw new Error(`unexpected git ls-tree entry: ${JSON.stringify(rec.slice(0, 120))}`);
    entries.set(m[4], `${m[1]} ${m[2]} ${m[3]}`);
  }
  const lines = [VERSION];
  for (const { path: p, required } of INPUT_PATHS) {
    const e = entries.get(p);
    if (!e && required) throw new Error(`build input ${p} is not in the commit`);
    lines.push(`${p}\t${e ?? "absent"}`);
    entries.delete(p);
  }
  if (entries.size) throw new Error(`git listed paths that are not build inputs: ${[...entries.keys()].join(", ")}`);
  return createHash("sha256").update(`${lines.join("\n")}\n`).digest("hex");
}

/** The hash for a commit of this repository, from git's committed trees (never the working tree). */
export function inputsAt(rev = "HEAD", run = defaultGit) {
  if (typeof rev !== "string" || !/^[0-9A-Za-z][\w./~^-]*$/.test(rev)) throw new Error(`not a revision: ${rev}`);
  return inputsHash(run(["ls-tree", "-z", "--full-tree", rev, "--", ...INPUT_PATHS.map((e) => e.path)]));
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultGit = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${inputsAt(process.argv[2] ?? "HEAD")}\n`);
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
