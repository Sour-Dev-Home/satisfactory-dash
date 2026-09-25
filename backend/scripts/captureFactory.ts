import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSatisfactoryServerConfigFromEnv } from "../src/modules/gameserver/connectionConfig.js";
import { FrmApiClient } from "../src/modules/gameserver/frmApiClient.js";
import { buildSample, formatSeries, seriesFileName } from "../src/modules/gameserver/captureSeries.js";
import type { CaptureSample } from "../src/modules/gameserver/captureSeries.js";

// DEV ONLY, and it needs the game up: polls FRM's getFactory and getPower every N seconds for M
// minutes and writes ONE trimmed, timestamped series under docs-vault/raw-sources/captured-responses,
// to tune the PROVISIONAL machine-state thresholds (ADR-0027, telemetry/services/classifyBuilding.ts)
// before the alert engine relies on them. It reads the same connection settings as the backend
// (backend/.env) and never writes the host, port or token anywhere. Run it only when the owner
// allows it; it makes read-only GETs against the game server.
//
//   npm run capture-factory -- [--minutes 15] [--interval 30]

const MAX_MINUTES = 120;
const MIN_INTERVAL_SECONDS = 10;

function numberFlag(name: string, fallback: number): number {
  // Both `--minutes 5` and `--minutes=5`.
  const equals = process.argv.find((arg) => arg.startsWith(`${name}=`));
  const at = process.argv.indexOf(name);
  if (equals === undefined && at === -1) {
    return fallback;
  }
  const value = Number(equals !== undefined ? equals.slice(name.length + 1) : process.argv[at + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${name} needs a positive number.`);
    process.exit(2);
  }
  return value;
}

const minutes = Math.min(numberFlag("--minutes", 15), MAX_MINUTES);
const intervalSeconds = Math.max(numberFlag("--interval", 30), MIN_INTERVAL_SECONDS);
const total = Math.max(1, Math.floor((minutes * 60) / intervalSeconds));

const config = loadSatisfactoryServerConfigFromEnv();
const frm = new FrmApiClient({
  host: config.host,
  port: config.frmPort,
  authToken: config.frmToken,
  timeoutMs: config.requestTimeoutMs,
});

const outDir = fileURLToPath(new URL("../../docs-vault/raw-sources/captured-responses/", import.meta.url));
const start = new Date();
const outFile = `${outDir}${seriesFileName(start)}`;
if (existsSync(outFile)) {
  console.error("That capture file already exists; raw-sources are never overwritten.");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const samples: CaptureSample[] = [];
console.log(`Capturing ${total} samples, ${intervalSeconds} s apart (about ${minutes} min). Ctrl+C stops early and saves nothing.`);
for (let i = 0; i < total; i++) {
  const [factory, power] = await Promise.all([
    frm.get<unknown>("getFactory").catch((err: unknown) => err),
    frm.get<unknown>("getPower").catch((err: unknown) => err),
  ]);
  const sample = buildSample(new Date(), factory, power);
  samples.push(sample);
  console.log(`${i + 1}/${total}: ${sample.factory?.length ?? "no"} buildings, ${sample.power?.length ?? "no"} circuits`);
  if (i < total - 1) {
    await sleep(intervalSeconds * 1000);
  }
}

mkdirSync(outDir, { recursive: true });
// "wx": fail rather than overwrite if the file appeared during the run (raw-sources are never overwritten).
writeFileSync(outFile, formatSeries({ start, intervalSeconds, samples }), { encoding: "utf8", flag: "wx" });
console.log(`Saved ${seriesFileName(start)} under docs-vault/raw-sources/captured-responses. Review it, then commit it.`);
