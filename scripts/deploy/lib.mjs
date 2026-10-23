// Pure parts of the production deploy (ADR-0049 D2, D4, D5): what an image reference may be, what a base task definition
// must look like, how CI copies one with a new image, and the release record. No I/O here; deploy.mjs does the calls.

/** The two pinned GHCR repositories (D2). Nothing else is ever registered. */
export const REPOSITORIES = {
  backend: "ghcr.io/sour-dev-home/satisfactory-dash-backend",
  ops: "ghcr.io/sour-dev-home/satisfactory-dash-ops",
};

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;

export const isSha = (s) => typeof s === "string" && SHA.test(s);
export const isDigest = (s) => typeof s === "string" && DIGEST.test(s);

/** `ghcr.io/sour-dev-home/satisfactory-dash-backend@sha256:…` for one of the two repositories, or a thrown error. */
export function imageRef(kind, digest) {
  if (!(kind in REPOSITORIES)) throw new Error(`unknown image kind: ${kind}`);
  if (!isDigest(digest)) throw new Error(`not a sha256 digest: ${digest}`);
  return `${REPOSITORIES[kind]}@${digest}`;
}

/**
 * From `docker buildx imagetools inspect <ref> --format '{{json .}}'`: the index digest, after checking the platforms
 * (linux/arm64 runs on Fargate) and that every platform's revision label is the sha we asked for (D4 step 1).
 */
export function digestFromInspect(inspect, sha) {
  const digest = inspect?.manifest?.digest;
  if (!isDigest(digest)) throw new Error("the image index has no sha256 digest");
  const platforms = (inspect.manifest.manifests ?? [])
    .map((m) => m.platform)
    .filter((p) => p && p.os !== "unknown")
    .map((p) => `${p.os}/${p.architecture}`);
  if (!platforms.includes("linux/arm64")) throw new Error(`no linux/arm64 image (has ${platforms.join(", ") || "none"})`);
  const images = inspect.image && typeof inspect.image === "object" ? Object.values(inspect.image) : [];
  if (images.length === 0) throw new Error("no image configs to check the revision label on");
  for (const img of images) {
    const revision = img?.config?.Labels?.["org.opencontainers.image.revision"];
    if (revision !== sha) throw new Error(`revision label is ${revision ?? "missing"}, not ${sha}`);
  }
  return digest;
}

/** The cloudflared pin in infra/aws/ecs.tf (`cloudflared_image = "…"`), which the backend base must carry (D2). */
export function cloudflaredPin(ecsTf) {
  const m = ecsTf.match(/^\s*cloudflared_image\s*=\s*"([^"]+@sha256:[0-9a-f]{64})"/m);
  if (!m) throw new Error("no cloudflared_image pin in ecs.tf");
  return m[1];
}

const roleName = (arn) => (typeof arn === "string" ? arn.split(":role/").pop() : undefined);

/**
 * D2: before production registers anything from the backend base, the base must be what Terraform applied: the
 * expected execution role, exactly the `backend` and `cloudflared` containers, and cloudflared at the pin.
 */
export function checkBackendBase(td, { environment, cloudflared }) {
  const problems = [];
  if (td.family !== `satis-${environment}`) problems.push(`family is ${td.family}`);
  if (roleName(td.executionRoleArn) !== `satis-${environment}-ecs-execution`) problems.push(`execution role is ${td.executionRoleArn}`);
  if (td.taskRoleArn) problems.push(`has a task role (${td.taskRoleArn}); the backend runs with none`);
  const names = (td.containerDefinitions ?? []).map((c) => c.name).sort();
  if (names.join(",") !== "backend,cloudflared") problems.push(`containers are ${names.join(", ") || "none"}`);
  const cf = (td.containerDefinitions ?? []).find((c) => c.name === "cloudflared");
  if (cf && cf.image !== cloudflared) problems.push(`cloudflared image is ${cf.image}, not the pin`);
  return problems;
}

/** The same check for the db-migrate base: its family, its own execution role and the one `ops` container. */
export function checkMigrateBase(td, { environment }) {
  const problems = [];
  if (td.family !== `satis-${environment}-ops-db-migrate`) problems.push(`family is ${td.family}`);
  if (roleName(td.executionRoleArn) !== `satis-${environment}-ops-db-migrate`) problems.push(`execution role is ${td.executionRoleArn}`);
  if (td.taskRoleArn) problems.push(`has a task role (${td.taskRoleArn})`);
  const names = (td.containerDefinitions ?? []).map((c) => c.name);
  if (names.join(",") !== "ops") problems.push(`containers are ${names.join(", ") || "none"}`);
  return problems;
}

// What RegisterTaskDefinition accepts from a described one; the rest (arn, revision, status, requiresAttributes,
// compatibilities, registeredAt/By, deregisteredAt) is ECS's own.
const REGISTERABLE = [
  "family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions", "volumes", "placementConstraints",
  "requiresCompatibilities", "cpu", "memory", "pidMode", "ipcMode", "proxyConfiguration", "inferenceAccelerators",
  "ephemeralStorage", "runtimePlatform", "enableFaultInjection",
];

/** A copy of the base with one container's image replaced, and nothing else changed (D2). No tags: the role has none. */
export function revisionFrom(base, container, image) {
  const input = {};
  for (const k of REGISTERABLE) if (base[k] !== undefined && base[k] !== null) input[k] = structuredClone(base[k]);
  const target = (input.containerDefinitions ?? []).find((c) => c.name === container);
  if (!target) throw new Error(`the base has no ${container} container`);
  target.image = image;
  return input;
}

/** The release record (`/satis/deploy/<env>/released`, D2): `{}` until the first release. */
export function parseReleased(value) {
  let r;
  try {
    r = JSON.parse(value ?? "{}");
  } catch {
    throw new Error("the released record is not JSON");
  }
  if (r === null || typeof r !== "object" || Array.isArray(r)) throw new Error("the released record is not an object");
  if (Object.keys(r).length === 0) return null;
  for (const k of ["sha", "backend", "ops", "taskDefinition"]) if (typeof r[k] !== "string") throw new Error(`released.${k} is missing`);
  return r;
}

/** The next record: this release, with the one it replaces as `previous` (one level deep, so it never grows). */
export function nextReleased(current, release) {
  const previous = current ? { sha: current.sha, backend: current.backend, ops: current.ops, taskDefinition: current.taskDefinition } : null;
  return { ...release, previous };
}

/**
 * Where a deployment stands for the revision we rolled out: `done`, `failed` (ECS rolled back or gave up) or `waiting`.
 * The newest deployment must be ours; if another one replaced it, that is a failure too.
 */
export function rolloutStatus(service, taskDefinition) {
  const deployments = service?.deployments ?? [];
  const ours = deployments.find((d) => d.taskDefinition === taskDefinition);
  if (!ours) return { state: "failed", reason: "our deployment is gone (rolled back or replaced)" };
  if (ours.rolloutState === "FAILED") return { state: "failed", reason: ours.rolloutStateReason ?? "rollout failed" };
  const primary = deployments.find((d) => d.status === "PRIMARY");
  if (primary && primary.taskDefinition !== taskDefinition) return { state: "failed", reason: `the service's primary is ${primary.taskDefinition}` };
  if (ours.rolloutState === "COMPLETED" && service.taskDefinition === taskDefinition) return { state: "done" };
  return { state: "waiting", reason: ours.rolloutStateReason ?? ours.rolloutState ?? "in progress" };
}

/** Alarm names in ALARM, from `describe-alarms`. */
export const alarming = (describe) => (describe?.MetricAlarms ?? []).filter((a) => a.StateValue === "ALARM").map((a) => a.AlarmName);

/** One Discord message per production outcome (D5): the action, the sha, short digests and the run link. */
export function noticeText({ outcome, action, sha, backend, ops, runUrl, detail }) {
  const short = (d) => (d ? d.slice(7, 19) : "?");
  const head = { released: "✅ Released", failed: "❌ Deploy failed", "rolled back": "↩️ Rolled back" }[outcome] ?? outcome;
  const lines = [`${head} (${action}) ${sha ? sha.slice(0, 8) : ""}`.trim(), `backend ${short(backend)} · ops ${short(ops)}`];
  if (detail) lines.push(detail.slice(0, 300));
  if (runUrl) lines.push(runUrl);
  return lines.join("\n");
}
