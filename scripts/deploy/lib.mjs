// Pure parts of the production deploy (ADR-0049 D2, D4, D5): what an image reference may be, what a base task definition
// must look like, how CI copies one with a new image, and the release record. No I/O here; deploy.mjs does the calls.
import { INPUTS_LABEL, isInputs } from "./inputs.mjs";

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
  // A single-platform image inspects as the config itself, not a platform map.
  const raw = inspect.image && typeof inspect.image === "object" ? inspect.image : null;
  const map = raw && ("config" in raw || "architecture" in raw) ? { [`${raw.os}/${raw.architecture}`]: raw } : (raw ?? {});
  const images = Object.values(map);
  if (images.length === 0) throw new Error("no image configs to check the revision label on");
  // The arm64 image itself must have a config to check, not just be listed in the index.
  if (!Object.keys(map).some((k) => k === "linux/arm64" || k.startsWith("linux/arm64/"))) throw new Error("no linux/arm64 image config to check the revision label on");
  for (const img of images) {
    const revision = img?.config?.Labels?.["org.opencontainers.image.revision"];
    if (revision !== sha) throw new Error(`revision label is ${revision ?? "missing"}, not ${sha}`);
  }
  return digest;
}

/**
 * ADR-0054 D1: the build-inputs label of an inspected image, or null unless every platform's config carries the same
 * valid hash. Null never matches a release record, so an image without the label (or with a broken one) deploys.
 */
export function inputsFromInspect(inspect) {
  const raw = inspect?.image && typeof inspect.image === "object" ? inspect.image : null;
  const map = raw && ("config" in raw || "architecture" in raw) ? { single: raw } : (raw ?? {});
  const values = Object.values(map).map((img) => img?.config?.Labels?.[INPUTS_LABEL]);
  if (values.length === 0 || !values.every((v) => isInputs(v) && v === values[0])) return null;
  return values[0];
}

/**
 * ADR-0054 D1, the automatic run's skip: why production already runs what `target` would ship ("images": the same
 * digests; "inputs": images built from the same build inputs), or null to deploy. Only a valid hash on both sides
 * matches, so a record from before the hash existed, or a target whose images lack it, always deploys.
 */
export function alreadyReleased(released, target) {
  if (!released || !target) return null;
  if (isDigest(target.backend) && isDigest(target.ops) && released.backend === target.backend && released.ops === target.ops) return "images";
  if (isInputs(released.inputs) && isInputs(target.inputs) && released.inputs === target.inputs) return "inputs";
  return null;
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
  return revisionWith(base, { [container]: image });
}

/** The same with several containers' images replaced at once (staging swaps three). */
export function revisionWith(base, images) {
  const input = {};
  for (const k of REGISTERABLE) if (base[k] !== undefined && base[k] !== null) input[k] = structuredClone(base[k]);
  for (const [container, image] of Object.entries(images)) {
    const target = (input.containerDefinitions ?? []).find((c) => c.name === container);
    if (!target) throw new Error(`the base has no ${container} container`);
    target.image = image;
  }
  return input;
}

export const STAGING_CONTAINERS = ["postgres", "db-previous", "db-setup", "backend", "cloudflared"];
const STAGING_POSTGRES = /^public\.ecr\.aws\/docker\/library\/postgres:18@sha256:[0-9a-f]{64}$/;

/**
 * D3: the staging base as Terraform applied it: its family and own execution role, no task role, exactly the five
 * containers in order, postgres from the ECR Public mirror by digest and cloudflared at the pin.
 */
export function checkStagingBase(td, { cloudflared }) {
  const problems = [];
  if (td.family !== "satis-staging") problems.push(`family is ${td.family}`);
  if (roleName(td.executionRoleArn) !== "satis-staging-ecs-execution") problems.push(`execution role is ${td.executionRoleArn}`);
  if (td.taskRoleArn) problems.push(`has a task role (${td.taskRoleArn})`);
  const names = (td.containerDefinitions ?? []).map((c) => c.name);
  if (names.join(",") !== STAGING_CONTAINERS.join(",")) problems.push(`containers are ${names.join(", ") || "none"}`);
  const image = (name) => (td.containerDefinitions ?? []).find((c) => c.name === name)?.image;
  if (!STAGING_POSTGRES.test(image("postgres") ?? "")) problems.push(`postgres image is ${image("postgres")}`);
  if (image("cloudflared") !== cloudflared) problems.push(`cloudflared image is ${image("cloudflared")}, not the pin`);
  return problems;
}

/** The staging network Terraform published: one subnet list, exactly one security group, a public IP for egress. */
export function checkStagingNetwork(net) {
  const v = net?.awsvpcConfiguration;
  const ok =
    v && Array.isArray(v.subnets) && v.subnets.length > 0 && v.subnets.every((s) => /^subnet-[0-9a-f]+$/.test(s)) &&
    Array.isArray(v.securityGroups) && v.securityGroups.length === 1 && /^sg-[0-9a-f]+$/.test(v.securityGroups[0]) &&
    v.assignPublicIp === "ENABLED" && Object.keys(v).length === 3;
  if (!ok) throw new Error("the published staging network is not one subnet list, one security group and a public IP");
  return net;
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
  if (r.previous != null) {
    if (typeof r.previous !== "object" || Array.isArray(r.previous)) throw new Error("released.previous is not an object");
    for (const k of ["sha", "backend", "ops", "taskDefinition"]) if (typeof r.previous[k] !== "string") throw new Error(`released.previous.${k} is missing`);
  }
  return r;
}

/**
 * The next record: this release, with the one it replaces as `previous` (one level deep, so it never grows). `inputs`
 * (ADR-0054 D1) is kept only when it is a valid hash of exactly the images recorded beside it; otherwise left out.
 */
export function nextReleased(current, release) {
  const entry = (r) => ({ sha: r.sha, backend: r.backend, ops: r.ops, taskDefinition: r.taskDefinition, ...(isInputs(r.inputs) ? { inputs: r.inputs } : {}) });
  return { ...entry(release), previous: current ? entry(current) : null };
}

/**
 * Where a deployment stands for the revision we rolled out: `done`, `failed` (ECS rolled back or gave up) or `waiting`.
 * The newest deployment must be ours; if another one replaced it, that is a failure too.
 */
export function rolloutStatus(service, taskDefinition) {
  const deployments = service?.deployments ?? [];
  const ours = deployments.find((d) => d.taskDefinition === taskDefinition);
  if (!ours) return { state: "failed", gone: true, reason: "our deployment is not listed (rolled back, replaced, or not listed yet)" };
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
