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
  /** Puts unread text back (piped input: the rest of the chunk belongs to the next prompt). */
  unshift?(chunk: string): unknown;
  readableEnded?: boolean;
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
      const chars = Array.from(chunk.toString());
      for (let index = 0; index < chars.length; index++) {
        const char = chars[index]!;
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
        if (char === "\r" || char === "\n") {
          finish();
          // Piped input: what follows this line belongs to the NEXT prompt (a CRLF is one line end). A terminal's type-ahead is dropped.
          if (!tty) {
            const rest = chars.slice(index + (char === "\r" && chars[index + 1] === "\n" ? 2 : 1)).join("");
            if (rest !== "") stdin.unshift?.(rest);
          }
          return;
        }
        if (char === "\u0003") return finish(new PromptAborted()); // Ctrl+C
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " " && char !== "\u007f") value += char;
      }
    }
    function onEnd() {
      finish();
    }
    if (!tty && stdin.readableEnded === true) return finish(); // an input that already ended never fires "end" again
    stdin.on("data", onData);
    stdin.on("end", onEnd);
  });
}
