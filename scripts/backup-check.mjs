#!/usr/bin/env node
// Daily freshness and integrity check of the encrypted backups in B2 (#502). It never decrypts anything and holds no
// private key: it needs only a READ-ONLY B2 application key, passed as AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
//
//   B2_BUCKET=... B2_ENDPOINT=https://s3.<region>.backblazeb2.com AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
//     node scripts/backup-check.mjs
//
// It fails (exit 1) when the newest `satis-*.dump.age` is older than 26 h, is smaller than a floor or far off the
// previous dump's size, or does not start with an age header. Exit 2 is a usage error. The keys are never printed.
// The workflow is .github/workflows/backup-check.yml; the local counterpart that restores is scripts/restore-check.mjs.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

/** An age file starts with this line (the v1 format), whatever the recipient type. */
export const AGE_MAGIC = "age-encryption.org/v1\n";
export const PREFIX = "satis-dash/";
export const DEFAULTS = { maxAgeHours: 26, minBytes: 2048, ratioLow: 0.5, ratioHigh: 2 };

const DUMP = /(^|\/)satis-[^/]+\.dump\.age$/;

/** The backups in an `aws s3api list-objects-v2` result, newest first. */
export function pickDumps(listing) {
  const contents = Array.isArray(listing?.Contents) ? listing.Contents : [];
  return contents
    .filter((o) => typeof o?.Key === "string" && DUMP.test(o.Key))
    .map((o) => ({ key: o.Key, size: Number(o.Size), modified: new Date(o.LastModified) }))
    .sort((a, b) => b.modified - a.modified);
}

/** The verdict: every rule is checked and every problem reported, so one run shows the whole picture. */
export function checkBackups({ dumps, headerBytes, now = new Date(), ...overrides }) {
  const { maxAgeHours, minBytes, ratioLow, ratioHigh } = { ...DEFAULTS, ...overrides };
  if (dumps.length === 0) return { ok: false, problems: ["no backup found (no satis-*.dump.age under the prefix)"], summary: "no backups" };

  const [newest, previous] = dumps;
  const problems = [];
  const ageHours = (now - newest.modified) / 3600_000;

  if (Number.isNaN(ageHours)) problems.push(`${newest.key} has no usable timestamp`);
  else if (ageHours < 0) problems.push(`${newest.key} is dated in the future (clock or listing problem)`);
  else if (ageHours > maxAgeHours) problems.push(`newest backup is older than ${maxAgeHours} h (${ageHours.toFixed(1)} h old)`);

  if (!(newest.size >= minBytes)) problems.push(`newest backup is ${newest.size} bytes, under the ${minBytes}-byte floor`);

  if (previous && previous.size > 0 && newest.size >= 0) {
    const ratio = newest.size / previous.size;
    if (ratio < ratioLow || ratio > ratioHigh) {
      problems.push(`newest backup is ${ratio.toFixed(2)}x the previous one's size (${newest.size} vs ${previous.size} bytes; allowed ${ratioLow} to ${ratioHigh})`);
    }
  }

  const head = headerBytes ? Buffer.from(headerBytes).subarray(0, AGE_MAGIC.length).toString("latin1") : "";
  if (head !== AGE_MAGIC) problems.push("newest backup does not start with an age header (not an age-encrypted file)");

  const summary = `${newest.key}: ${newest.size} bytes, ${Number.isNaN(ageHours) ? "?" : ageHours.toFixed(1)} h old, ${dumps.length} backups listed`;
  return { ok: problems.length === 0, problems, summary };
}

/**
 * List, then read only the first bytes of the newest object. `aws` is injected: `aws(["list"])` resolves to the
 * parsed listing, `aws(["head", key])` to a Buffer of the object's first bytes.
 */
export async function runCheck({ aws, now = new Date(), ...overrides }) {
  let dumps;
  try {
    dumps = pickDumps(await aws(["list"]));
  } catch (err) {
    return { ok: false, problems: [`listing the bucket failed: ${err.message}`], summary: "listing failed" };
  }
  if (dumps.length === 0) return checkBackups({ dumps, headerBytes: null, now, ...overrides });
  let headerBytes = null;
  try {
    headerBytes = await aws(["head", dumps[0].key]);
  } catch (err) {
    const r = checkBackups({ dumps, headerBytes: null, now, ...overrides });
    return { ...r, ok: false, problems: [`reading ${dumps[0].key} failed: ${err.message}`, ...r.problems] };
  }
  return checkBackups({ dumps, headerBytes, now, ...overrides });
}

/** The real `aws`: the AWS CLI v2 (preinstalled on GitHub's ubuntu runners) against B2's S3 endpoint. */
function realAws({ bucket, endpoint }) {
  const base = ["--endpoint-url", endpoint, "--no-cli-pager"];
  // B2 signs for the region in its endpoint host (s3.<region>.backblazeb2.com).
  const region = /^https:\/\/s3\.([a-z0-9-]+)\.backblazeb2\.com/.exec(endpoint)?.[1];
  const env = {
    ...process.env,
    ...(region ? { AWS_DEFAULT_REGION: region } : {}),
    AWS_REQUEST_CHECKSUM_CALCULATION: "when_required",
    AWS_RESPONSE_CHECKSUM_VALIDATION: "when_required",
  };
  return async ([op, key]) => {
    if (op === "list") {
      const { stdout } = await run("aws", ["s3api", "list-objects-v2", "--bucket", bucket, "--prefix", PREFIX, "--output", "json", ...base], { env, maxBuffer: 8e6 });
      return stdout.trim() ? JSON.parse(stdout) : {};
    }
    const dir = await mkdtemp(path.join(tmpdir(), "backup-check-"));
    try {
      const out = path.join(dir, "head");
      await run("aws", ["s3api", "get-object", "--bucket", bucket, "--key", key, "--range", "bytes=0-63", out, ...base], { env });
      return await readFile(out);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

async function main() {
  const { B2_BUCKET: bucket, B2_ENDPOINT: endpoint } = process.env;
  if (!bucket || !endpoint?.startsWith("https://") || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error("Set B2_BUCKET, B2_ENDPOINT (https://...), AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (the read-only B2 key).");
    process.exit(2);
  }
  const result = await runCheck({ aws: realAws({ bucket, endpoint }) });
  console.log(result.ok ? `OK  ${result.summary}` : `FAIL  ${result.summary}`);
  for (const p of result.problems) console.log(`  - ${p}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [`## Backup check: ${result.ok ? "ok" : "FAILED"}`, "", result.summary, "", ...result.problems.map((p) => `- ${p}`), ""].join("\n"));
  }
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
