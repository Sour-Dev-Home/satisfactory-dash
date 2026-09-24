// Guards the guard (ADR-0026): the oxlint rules that keep network calls in
// src/api/transport.ts must keep catching every form. Writes a throwaway file into src/ that
// uses each one, lints it with the real config, and fails unless every form is reported.
// Runs as part of `npm run lint`, so a config change that drops coverage fails CI.
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const probe = fileURLToPath(new URL("../src/__network-lint-probe.ts", import.meta.url));

// One line per form; each must produce its own report.
const FORMS = [
  ["fetch", 'export const a = () => fetch("/x");'],
  ["window.fetch", 'export const b = () => window.fetch("/x");'],
  ["globalThis.fetch", 'export const c = () => globalThis.fetch("/x");'],
  ["self.fetch", 'export const d = () => self.fetch("/x");'],
  ["XMLHttpRequest", "export const e = () => new XMLHttpRequest();"],
  ["EventSource", 'export const f = () => new EventSource("/x");'],
  ["WebSocket", 'export const g = () => new WebSocket("wss://x");'],
  ["navigator.sendBeacon", 'export const h = () => navigator.sendBeacon("/x");'],
];

writeFileSync(probe, FORMS.map(([, line]) => line).join("\n") + "\n");
try {
  // One command string (npx needs a shell on Windows); the path is quoted.
  const run = spawnSync(`npx oxlint --format unix "${probe}"`, { encoding: "utf8", shell: true });
  const output = `${run.stdout}\n${run.stderr}`;
  const reportedLines = new Set(
    [...output.matchAll(/__network-lint-probe\.ts:(\d+):\d+: .*no-restricted-(?:globals|properties)/g)].map((m) => Number(m[1])),
  );
  const missed = FORMS.filter((_, i) => !reportedLines.has(i + 1)).map(([name]) => name);
  if (missed.length > 0) {
    console.error(`Network lint lost coverage for: ${missed.join(", ")}\n\n${output}`);
    process.exit(1);
  }
  console.log(`Network lint: all ${FORMS.length} forms still reported.`);
} finally {
  rmSync(probe, { force: true });
}
