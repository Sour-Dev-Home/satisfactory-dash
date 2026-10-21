import { createDpapi } from "./dpapi.js";
import { PromptAborted, readHidden } from "./prompt.js";
import { runCli } from "./cli.js";
import { FATAL_LINE, installFatalHandlers } from "./fatal.js";

/** The executable's entry (the only file with side effects; everything else takes its inputs, so it is testable). */
async function main(): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const code = await runCli(process.argv.slice(2), {
    env: process.env,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    dpapi: createDpapi(),
    prompt: (question) => readHidden(question, { stdin: process.stdin as never, stderr: process.stderr }),
    signal: controller.signal,
  });
  process.exitCode = code;
  process.stdin.pause();
}

installFatalHandlers({ target: process, err: (line) => process.stderr.write(line), exit: (code) => process.exit(code) });

main().catch((err: unknown) => {
  // A cancelled prompt is a normal end; anything else prints no detail (it could carry a secret), only that it failed.
  if (!(err instanceof PromptAborted)) process.stderr.write(FATAL_LINE);
  process.exitCode = 1;
});
