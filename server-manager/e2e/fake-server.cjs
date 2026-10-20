// A stand-in for FactoryServer.exe (ADR-0040: CI never needs the game). The e2e harness copies it into a temp folder
// as FactoryServer.exe and the app runs it with Node. It logs each start to starts.log, then obeys files the test drops
// beside it: `crash-now` (exit 1 once), `exit-now` (exit 0 once), `crash-always` (every start exits 1 after 300 ms).
// It also exits when its parent (the app) is gone, so no test leaves a process behind, unless `keep-running` is there
// (dropped before Start, for the tests of Quit leaving the server running): then it outlives the app, for at most
// 60 s, and the test ends it.
const fs = require("node:fs");
const path = require("node:path");

const dir = __dirname;
const take = (name) => {
  try {
    fs.unlinkSync(path.join(dir, name));
    return true;
  } catch {
    return false;
  }
};

fs.appendFileSync(path.join(dir, "starts.log"), `${process.pid} ${process.argv.slice(2).join(" ")}\n`);
if (fs.existsSync(path.join(dir, "crash-always"))) setTimeout(() => process.exit(1), 300);

const parent = process.ppid;
const keepRunning = fs.existsSync(path.join(dir, "keep-running"));
if (keepRunning) setTimeout(() => process.exit(0), 60_000);
setInterval(() => {
  if (take("crash-now")) process.exit(1);
  if (take("exit-now")) process.exit(0);
  if (keepRunning) return;
  try {
    process.kill(parent, 0);
  } catch {
    process.exit(0);
  }
}, 100);
