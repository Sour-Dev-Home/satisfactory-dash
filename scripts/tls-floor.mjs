#!/usr/bin/env node
// The TLS 1.2 floor for a self-hosted backend (#493). The game mod's HTTP client (UE's libcurl) offers TLS 1.0-1.3 and
// can't raise its own floor, so the host must refuse anything older than 1.2. Behind the compose `tunnel` profile, TLS
// ends at the host's Cloudflare zone, whose Minimum TLS Version defaults to 1.0; nothing in compose can change that.
//
//   node scripts/tls-floor.mjs check <hostname>   # fails unless 1.0 and 1.1 are refused and 1.2 is accepted
//   CF_API_TOKEN=... CF_ZONE_ID=... node scripts/tls-floor.mjs set-cloudflare
//                                                 # sets the zone's Minimum TLS Version to 1.2 (idempotent)
//
// The token needs only "Zone Settings: Edit" on that one zone. It's read from the environment and never printed.
// The probes lower the CLIENT's own floor (OpenSSL @SECLEVEL=0), so a refusal is the server's, not the client's:
// a client that can't even offer the old version counts as inconclusive, never as a pass.
import tls from "node:tls";
import { fileURLToPath } from "node:url";

export const FLOOR = "1.2";
const OLD = ["TLSv1", "TLSv1.1"];
const CF_API = "https://api.cloudflare.com/client/v4";

/** One probe's outcome, from the handshake result or the error it ended with. */
export function probeOutcome(result) {
  if (result.ok) return "accepted";
  if (result.code === "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION" || /alert protocol version/i.test(result.message ?? "")) {
    return "refused";
  }
  if (result.code === "ERR_SSL_NO_PROTOCOLS_AVAILABLE" || /no protocols available/i.test(result.message ?? "")) {
    return "client-cannot-offer";
  }
  return "error";
}

/** The verdict over all probes: every old version refused by the server, and 1.2 accepted. */
export function verdict(outcomes) {
  const problems = [];
  for (const version of OLD) {
    const o = outcomes[version];
    if (o === "accepted") problems.push(`${version} was accepted: the host's floor is below ${FLOOR}`);
    else if (o === "client-cannot-offer") problems.push(`${version}: this machine's TLS library can't offer it, so the check is inconclusive`);
    else if (o !== "refused") problems.push(`${version}: the handshake failed for another reason (${o}), so the check is inconclusive`);
  }
  if (outcomes["TLSv1.2"] !== "accepted") problems.push(`TLSv1.2 was not accepted (${outcomes["TLSv1.2"]}): clients can't connect at all`);
  return { ok: problems.length === 0, problems };
}

/** What set-cloudflare should do for a zone currently at `current` (Cloudflare's values: "1.0".."1.3"). */
export function planZoneChange(current) {
  if (!/^1\.[0-3]$/.test(String(current))) throw new Error(`unexpected min_tls_version value: ${JSON.stringify(current)}`);
  return Number(current) >= Number(FLOOR) ? { change: false, value: current } : { change: true, value: FLOOR };
}

function probe(host, version) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host,
      port: 443,
      servername: host,
      minVersion: version,
      maxVersion: version,
      ciphers: "DEFAULT:@SECLEVEL=0",
      timeout: 10_000,
    });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("secureConnect", () => done({ ok: true }));
    socket.once("error", (err) => done({ ok: false, code: err.code, message: err.message }));
    socket.once("timeout", () => done({ ok: false, code: "ETIMEDOUT", message: "timed out" }));
  });
}

async function check(host) {
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host)) throw new Error("usage: tls-floor.mjs check <hostname>");
  const outcomes = {};
  for (const version of [...OLD, "TLSv1.2"]) outcomes[version] = probeOutcome(await probe(host, version));
  for (const [version, o] of Object.entries(outcomes)) console.log(`${version}: ${o}`);
  const result = verdict(outcomes);
  for (const p of result.problems) console.error(`FAIL ${p}`);
  if (result.ok) console.log(`OK ${host} refuses TLS below ${FLOOR}`);
  return result.ok;
}

async function cf(path, init = {}) {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const why = (body.errors ?? []).map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API: ${why}`);
  }
  return body.result;
}

async function setCloudflare() {
  const zone = process.env.CF_ZONE_ID;
  if (!process.env.CF_API_TOKEN || !zone || !/^[a-f0-9]{32}$/.test(zone)) {
    throw new Error("set CF_API_TOKEN and CF_ZONE_ID (the zone's 32-character id) in the environment");
  }
  const setting = `/zones/${zone}/settings/min_tls_version`;
  const before = (await cf(setting)).value;
  const plan = planZoneChange(before);
  if (!plan.change) {
    console.log(`Minimum TLS Version is already ${before}: nothing to change`);
    return true;
  }
  const after = (await cf(setting, { method: "PATCH", body: JSON.stringify({ value: plan.value }) })).value;
  console.log(`Minimum TLS Version: ${before} -> ${after}`);
  return after === plan.value;
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  try {
    const ok = command === "check" ? await check(arg) : command === "set-cloudflare" ? await setCloudflare() : null;
    if (ok === null) throw new Error("usage: tls-floor.mjs check <hostname> | set-cloudflare");
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
