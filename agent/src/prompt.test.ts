import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { PromptAborted, readHidden } from "./prompt.js";
import type { PromptInput } from "./prompt.js";

function fakeTty() {
  const stream = new PassThrough() as PassThrough & PromptInput & { rawModes: boolean[] };
  stream.isTTY = true;
  stream.rawModes = [];
  stream.setRawMode = (mode: boolean) => {
    stream.rawModes.push(mode);
    return stream;
  };
  return stream;
}
const errors = () => {
  const written: string[] = [];
  return { written, stderr: { write: (text: string) => written.push(text) } };
};

describe("readHidden", () => {
  it("on a terminal: raw mode on while typing, off after; the secret is returned and never written back (no echo)", async () => {
    const stdin = fakeTty();
    const { written, stderr } = errors();
    const pending = readHidden("API token: ", { stdin, stderr });
    stdin.write("tok_abc");
    stdin.write("DEF-123\r");
    expect(await pending).toBe("tok_abcDEF-123");
    expect(stdin.rawModes).toEqual([true, false]);
    expect(written.join("")).toBe("API token: \n"); // the question and a newline, nothing typed
  });

  it("handles a pasted value in one chunk, backspace, and ignores control characters", async () => {
    const stdin = fakeTty();
    const pending = readHidden("q: ", { stdin, stderr: errors().stderr });
    stdin.write("abcX\u007f\u007fd\u001b[Ae\n");
    expect(await pending).toBe("abde"); // "abcX", two backspaces -> "ab", then "d", the up-arrow sequence skipped whole, then "e"
  });

  it("Ctrl+C cancels with PromptAborted and restores the terminal", async () => {
    const stdin = fakeTty();
    const pending = readHidden("q: ", { stdin, stderr: errors().stderr });
    stdin.write("partial\u0003");
    await expect(pending).rejects.toBeInstanceOf(PromptAborted);
    expect(stdin.rawModes).toEqual([true, false]);
  });

  it("not a terminal (a piped value): reads one line, and never touches raw mode", async () => {
    const stdin = new PassThrough() as PassThrough & PromptInput;
    const pending = readHidden("q: ", { stdin, stderr: errors().stderr });
    stdin.write("piped-secret\r\nsecond line ignored\n");
    expect(await pending).toBe("piped-secret");
  });

  it("an input that ends without a newline returns what it has (an empty value is the caller's to refuse)", async () => {
    const stdin = new PassThrough() as PassThrough & PromptInput;
    const pending = readHidden("q: ", { stdin, stderr: errors().stderr });
    stdin.end("no newline");
    expect(await pending).toBe("no newline");
    const empty = new PassThrough() as PassThrough & PromptInput;
    const none = readHidden("q: ", { stdin: empty, stderr: errors().stderr });
    empty.end();
    expect(await none).toBe("");
  });
});
