/**
 * A hidden prompt (ADR-0031 PR 6, architect rule 3): the game's tokens are typed or pasted at a prompt with no echo, never
 * given as an argument (command lines are visible to other processes and to process-audit logs) and never read from the
 * environment. On a terminal the input is read character by character with echo off; when stdin is not a terminal (a
 * script piping a value in) one line is read from it. The question goes to stderr so stdout stays clean.
 */

export interface PromptInput {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  resume(): unknown;
  pause(): unknown;
  setEncoding?(encoding: BufferEncoding): unknown;
  on(event: "data", listener: (chunk: string | Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  removeListener(event: "data", listener: (chunk: string | Buffer) => void): unknown;
  removeListener(event: "end", listener: () => void): unknown;
}

export class PromptAborted extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "PromptAborted";
  }
}

export function readHidden(question: string, io: { stdin: PromptInput; stderr: { write(text: string): unknown } }): Promise<string> {
  const { stdin, stderr } = io;
  return new Promise<string>((resolve, reject) => {
    const tty = stdin.isTTY === true && typeof stdin.setRawMode === "function";
    let value = "";
    stderr.write(question);
    stdin.setEncoding?.("utf8");
    if (tty) stdin.setRawMode?.(true);
    stdin.resume();

    const finish = (error?: Error) => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      if (tty) stdin.setRawMode?.(false);
      stdin.pause();
      stderr.write("\n");
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    // An arrow or function key arrives as ESC [ ... <letter>: skipped whole, so "[A" never lands in a secret.
    let escape: "none" | "esc" | "csi" = "none";
    function onData(chunk: string | Buffer) {
      for (const char of chunk.toString()) {
        if (escape === "esc") {
          escape = char === "[" ? "csi" : "none";
          continue;
        }
        if (escape === "csi") {
          if (/[A-Za-z~]/.test(char)) escape = "none";
          continue;
        }
        if (char === "\u001b") {
          escape = "esc";
          continue;
        }
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new PromptAborted()); // Ctrl+C
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " " && char !== "\u007f") value += char;
      }
    }
    function onEnd() {
      finish();
    }
    stdin.on("data", onData);
    stdin.on("end", onEnd);
  });
}
