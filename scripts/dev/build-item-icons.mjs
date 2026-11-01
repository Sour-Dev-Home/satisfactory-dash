#!/usr/bin/env node
// Rebuild the Planner's item icons (ADR-0060 Decision 6) from the owner's FModel export of the game's textures.
//
//   node scripts/dev/build-item-icons.mjs --src <dir> [--out <dir>]
//
//   --src  the export's Resource folder (searched recursively for `<texture>_256.png`, or `_512.png` when a
//          texture has no 256 px file). Never committed: it is a path on the owner's disk.
//   --out  where the WebP files go (default frontend/public/game-assets/items).
//
// Which slugs to build comes from the table in frontend/src/planner/graph/itemIcons.ts, so the folder holds exactly
// the files the table names: every slug at 32, 64 and 128 px (`<slug>-<size>.webp`), and nothing else. A slug is the
// texture name in kebab case without `IconDesc_` and the size suffix. It converts with the same pinned sharp-cli as
// the building icons (WebP, quality 85, `--fit contain`; see game-assets/NOTICE.md), through npm exec, so no image
// library is a dependency of the repo.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { npmInvocation, parseArgs } from "./lib.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const TABLE = join(ROOT, "frontend", "src", "planner", "graph", "itemIcons.ts");
export const SIZES = [32, 64, 128];
export const SHARP_CLI = "sharp-cli@6.1.0";

/** `IconDesc_IronPlates_256` -> `iron-plates`; `LiquidOil_Pipe_512` -> `liquid-oil-pipe`. Undefined for other names. */
export function slugOfTexture(fileName) {
  const m = /^(?:IconDesc_)?(.+)_(256|512)\.png$/.exec(fileName);
  if (m === null) return undefined;
  return m[1]
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

/** The slugs named by itemIcons.ts' `SLUG_BY_CLASS` table, in table order, without repeats. */
export function slugsFromTable(source) {
  const start = source.indexOf("const SLUG_BY_CLASS");
  const end = source.indexOf("]);", start);
  if (start === -1 || end === -1) throw new Error("itemIcons.ts: SLUG_BY_CLASS table not found");
  const slugs = [...source.slice(start, end).matchAll(/\[\s*"[^"]+",\s*"([a-z0-9-]+)"\s*\]/g)].map((m) => m[1]);
  if (slugs.length === 0) throw new Error("itemIcons.ts: SLUG_BY_CLASS table is empty");
  return [...new Set(slugs)];
}

/**
 * Pick one source file per slug from `files` ({ name, path }). A 256 px texture wins over a 512 px one; two different
 * textures with the same slug and size are an error, since the result would depend on the walk order.
 */
export function pickSources(files) {
  const bySlug = new Map();
  const errors = [];
  for (const f of files) {
    const slug = slugOfTexture(f.name);
    if (slug === undefined) continue;
    const size = f.name.endsWith("_256.png") ? 256 : 512;
    const had = bySlug.get(slug);
    if (had === undefined || (had.size === 512 && size === 256)) bySlug.set(slug, { ...f, size });
    else if (had.size === size) errors.push(`two textures give the slug "${slug}": ${had.name} and ${f.name}`);
  }
  return { bySlug, errors };
}

/** Every regular file under `dir`, as { name, path }; symlinks are skipped. */
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push({ name: e.name, path: full });
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.src !== "string") {
    console.error("usage: node scripts/dev/build-item-icons.mjs --src <the FModel export's Resource folder> [--out <dir>]");
    process.exit(2);
  }
  const out = resolve(typeof args.out === "string" ? args.out : join(ROOT, "frontend", "public", "game-assets", "items"));
  const slugs = slugsFromTable(readFileSync(TABLE, "utf8"));
  const { bySlug, errors } = pickSources(walk(resolve(args.src)));
  const missing = slugs.filter((s) => !bySlug.has(s));
  if (missing.length > 0) errors.push(`no texture in --src for: ${missing.join(", ")}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`build-item-icons: ${e}`);
    process.exit(1);
  }

  const work = mkdtempSync(join(tmpdir(), "item-icons-"));
  try {
    // Stage each texture as <slug>.png, so sharp-cli's output names are already the slugs.
    const stage = join(work, "png");
    mkdirSync(stage);
    for (const s of slugs) copyFileSync(bySlug.get(s).path, join(stage, `${s}.png`));

    mkdirSync(out, { recursive: true });
    for (const f of readdirSync(out)) if (f.endsWith(".webp")) rmSync(join(out, f));

    const npm = npmInvocation();
    for (const size of SIZES) {
      const dest = join(work, String(size));
      mkdirSync(dest);
      const sharpArgs = ["-i", ...slugs.map((s) => `${s}.png`), "-o", dest, "-f", "webp", "--quality", "85", "resize", String(size), String(size), "--fit", "contain"];
      const r = spawnSync(npm.cmd, [...npm.args, "exec", "--yes", `--package=${SHARP_CLI}`, "--", "sharp", ...sharpArgs], { cwd: stage, stdio: ["ignore", "ignore", "inherit"] });
      if (r.status !== 0) throw new Error(`sharp-cli failed at ${size} px (exit ${r.status ?? r.signal})`);
      for (const s of slugs) renameSync(join(dest, `${s}.webp`), join(out, `${s}-${size}.webp`));
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`build-item-icons: ${slugs.length} items x ${SIZES.length} sizes written to ${out}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
