// Last step of `npm run demo:video` (ADR-0026): demo-video/walkthrough.webm -> walkthrough.mp4,
// H.264 + yuv420p so every browser and social site plays it, with the index at the front
// (faststart) so it starts before it's fully downloaded. Needs ffmpeg on PATH; CI's Ubuntu
// runners have it. Without it, the WebM and poster are still there and this says so.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const out = join(import.meta.dirname, "..", "demo-video");
const webm = join(out, "walkthrough.webm");
const mp4 = join(out, "walkthrough.mp4");

if (!existsSync(webm)) {
  console.error(`No ${webm}: run the recording first (npm run demo:video).`);
  process.exit(1);
}
if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).error) {
  console.error("ffmpeg isn't on PATH: kept walkthrough.webm and poster.png, skipped the MP4.");
  process.exit(1);
}
const result = spawnSync(
  "ffmpeg",
  ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "slow", "-crf", "20",
    "-pix_fmt", "yuv420p", "-r", "25", "-movflags", "+faststart", "-an", mp4],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Wrote ${mp4}`);
