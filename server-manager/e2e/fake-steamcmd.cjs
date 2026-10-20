// A stand-in for steamcmd.exe (ADR-0040: CI never needs Steam). The e2e harness copies it into a temp folder as
// steamcmd.exe and the app runs it with Node. It logs its arguments to steamcmd-args.log (one per line), prints
// SteamCMD-like progress a line at a time, then exits with the code in a `steamcmd-exit` file beside it (0 without one).
const fs = require("node:fs");
const path = require("node:path");

const dir = __dirname;
fs.writeFileSync(path.join(dir, "steamcmd-args.log"), `${process.argv.slice(2).join("\n")}\n`);

let code = 0;
try {
  code = Number(fs.readFileSync(path.join(dir, "steamcmd-exit"), "utf8").trim()) || 0;
} catch {
  // No file: a successful update.
}

const lines = [
  "Redirecting stderr to 'logs\\stderr.txt'",
  "Loading Steam API...OK",
  " Update state (0x61) downloading, progress: 25.00 (200 / 800)",
  " Update state (0x61) downloading, progress: 100.00 (800 / 800)",
  code === 0 ? "Success! App '1690800' fully installed." : "Error! App '1690800' state is 0x202 after update job.",
];
let i = 0;
const timer = setInterval(() => {
  if (i < lines.length) {
    process.stdout.write(`${lines[i++]}\r\n`);
    return;
  }
  clearInterval(timer);
  process.exit(code);
}, 150);
