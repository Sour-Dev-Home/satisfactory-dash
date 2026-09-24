// Last step of `npm run demo:video` (ADR-0026): the recording's lossless PNG frames
// (demo-video/frames.txt, an ffmpeg concat list with per-frame durations) -> walkthrough.mp4.
//
// The owner saw colours flicker and shift in the first video. Two causes, both handled here:
// - the old source was Playwright's lossy VP8 screencast (now PNG frames: e2e/video/);
// - the MP4 carried no colour tags, so each decoder guessed the matrix and range (a GPU
//   decoder differently from software). Now: sRGB -> BT.709 limited range, tagged as such.
// Plus a constant 25 fps, a fixed GOP, and the index at the front (faststart). H.264 +
// yuv420p so every browser plays it. Needs ffmpeg and ffprobe on PATH (CI's job installs
// them); without them the frames and poster stay and this says so.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const out = join(import.meta.dirname, "..", "demo-video");
const list = join(out, "frames.txt");
const mp4 = join(out, "walkthrough.mp4");
const FPS = 25;

if (!existsSync(list)) {
  console.error(`No ${list}: run the recording first (npm run demo:video).`);
  process.exit(1);
}
if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).error) {
  console.error("ffmpeg isn't on PATH: kept the frames and poster.png, skipped the MP4.");
  process.exit(1);
}

const encode = spawnSync(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", list,
    // Screen pixels are sRGB, full range: convert to what the tags below promise.
    "-vf", `fps=${FPS},scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "stillimage",
    "-g", String(FPS * 2), "-keyint_min", String(FPS * 2), "-sc_threshold", "0",
    "-fps_mode", "cfr", "-r", String(FPS),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-movflags", "+faststart", "-an", mp4,
  ],
  { stdio: "inherit" },
);
if (encode.status !== 0) process.exit(encode.status ?? 1);

// Fail rather than ship an untagged file again: read the tags back.
const probe = spawnSync(
  "ffprobe",
  ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=color_space,color_primaries,color_transfer,color_range,r_frame_rate", "-of", "json", mp4],
  { encoding: "utf8" },
);
if (probe.status !== 0) {
  console.error(`ffprobe failed: ${probe.stderr || probe.error}`);
  process.exit(1);
}
const stream = JSON.parse(probe.stdout).streams?.[0] ?? {};
const want = { color_space: "bt709", color_primaries: "bt709", color_transfer: "bt709", color_range: "tv", r_frame_rate: `${FPS}/1` };
const wrong = Object.entries(want).filter(([key, value]) => stream[key] !== value);
if (wrong.length > 0) {
  console.error(`walkthrough.mp4 has the wrong colour or frame-rate tags: ${wrong.map(([k, v]) => `${k}=${stream[k]} (want ${v})`).join(", ")}`);
  process.exit(1);
}

rmSync(join(out, "frames"), { recursive: true, force: true });
rmSync(list, { force: true });
console.log(`Wrote ${mp4} (${JSON.stringify(stream)})`);
