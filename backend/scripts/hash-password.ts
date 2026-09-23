/**
 * Prints a scrypt hash for DASHBOARD_ADMIN_PASSWORD_HASH (ADR-0011).
 *
 *   npm run hash-password -w backend
 *
 * The password is read without echo from the terminal, or from stdin when piped. It is
 * never taken as a command-line argument, which would land in shell history.
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { hashPassword } from "../src/modules/identity/passwordHash.js";

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf-8").replace(/\r?\n$/, "");
  }
  process.stdout.write("Password (not shown): ");
  const muted = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  const password = await new Promise<string>((resolve) => rl.question("", resolve));
  rl.close();
  process.stdout.write("\n");
  return password;
}

const password = await readPassword();
if (password.length < 12) {
  console.error("Use at least 12 characters.");
  process.exit(1);
}
console.log(await hashPassword(password));
