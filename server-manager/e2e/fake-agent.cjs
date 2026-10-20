// A stand-in for PowerShell's ScheduledTask cmdlets and for the built agent, so the e2e tests never reach the real Task
// Scheduler or agent (a live agent may run on the machine). Under the e2e switch the app runs this file, from its fixed
// place beside the app, as `fake-agent.cjs powershell -NoProfile -NonInteractive -Command <script>` or
// `fake-agent.cjs agent <command>`. Its state lives in the agent's (temp) data folder, SD_AGENT_HOME:
//   fake-task       the task's state as Get-ScheduledTask prints it (Running, Ready, Disabled, Missing); Ready without one
//   fake-calls.log  one line per call: `powershell Get-ScheduledTask`, `agent check`, ...
const fs = require("node:fs");
const path = require("node:path");

const home = process.env.SD_AGENT_HOME;
if (!home) {
  process.stderr.write("fake-agent: no SD_AGENT_HOME\n");
  process.exit(2);
}
const [program, ...args] = process.argv.slice(2);
const stateFile = path.join(home, "fake-task");
const log = (line) => fs.appendFileSync(path.join(home, "fake-calls.log"), `${line}\n`);
const state = () => (fs.existsSync(stateFile) ? fs.readFileSync(stateFile, "utf8").trim() : "Ready");

if (program === "powershell") {
  const script = args[args.indexOf("-Command") + 1] ?? "";
  // The app must name only its constant task.
  if (!script.includes("-TaskName 'Satisfactory Dash Agent'")) process.exit(2);
  const cmdlet = /(Get|Start|Stop)-ScheduledTask/.exec(script)?.[0];
  if (cmdlet === undefined) process.exit(2);
  log(`powershell ${cmdlet}`);
  if (cmdlet === "Get-ScheduledTask") process.stdout.write(state());
  else if (state() === "Missing") process.exit(1);
  else fs.writeFileSync(stateFile, cmdlet === "Start-ScheduledTask" ? "Running" : "Ready");
  process.exit(0);
}

if (program === "agent") {
  const [command] = args;
  log(`agent ${args.join(" ")}`);
  if (command === "check") {
    process.stdout.write("Game reachable at 127.0.0.1:7777 (fake check).\n");
    process.exit(0);
  }
  if (command === "status") {
    process.stdout.write("Store: opens. Tokens set: apiToken (fake status).\n");
    process.exit(0);
  }
  if (command === "resume") {
    fs.rmSync(path.join(home, "halted.json"), { force: true });
    process.stdout.write("Cleared the halted marker (fake resume).\n");
    process.exit(0);
  }
  process.stderr.write(`fake-agent: no command ${command}\n`);
  process.exit(1);
}

process.exit(2);
