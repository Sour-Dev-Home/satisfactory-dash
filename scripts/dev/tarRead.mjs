// A small, strict ustar reader for the archive the remote box sends back. The box is LESS trusted than this PC, so the
// archive is parsed here instead of by the system tar (Git for Windows' GNU tar copies a symlink's target into a plain
// file). Only regular .png files and directories are accepted; anything else rejects the WHOLE archive before a single
// byte is written. Symlinks are never created.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
export const MAX_FILES = 2000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NAME_RE = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.png$/;

const cstr = (buf, start, len) => {
  const end = buf.indexOf(0, start);
  return buf.toString("latin1", start, end >= 0 && end < start + len ? end : start + len);
};

function octal(buf, start, len) {
  const s = cstr(buf, start, len).trim();
  if (!/^[0-7]+$/.test(s)) throw new Error("tar: bad size field");
  return parseInt(s, 8);
}

/** Parses `buf` and returns [{ name, data }] for the regular .png files; throws on anything unexpected. */
export function parsePngTar(buf) {
  const files = [];
  let total = 0;
  let off = 0;
  while (off + 512 <= buf.length) {
    const hdr = buf.subarray(off, off + 512);
    if (hdr.every((b) => b === 0)) break; // end-of-archive marker
    const type = String.fromCharCode(hdr[156]);
    const rawName = cstr(hdr, 0, 100);
    const prefix = cstr(hdr, 345, 155);
    const name = (prefix ? `${prefix}/${rawName}` : rawName).replace(/^\.\//, "");
    const size = octal(hdr, 124, 12);
    off += 512;
    if (type === "5") continue; // directory: ignored (its size is 0)
    if (type !== "0" && type !== "\0") throw new Error(`tar: refusing entry type ${JSON.stringify(type)} (${name.slice(0, 80)}): only regular files are allowed`);
    if (!NAME_RE.test(name) || name.split("/").includes("..")) throw new Error(`tar: refusing unexpected file name ${JSON.stringify(name.slice(0, 80))}`);
    if (size > MAX_FILE_BYTES) throw new Error(`tar: ${name} is larger than ${MAX_FILE_BYTES} bytes`);
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error("tar: archive is too large");
    if (files.length >= MAX_FILES) throw new Error(`tar: more than ${MAX_FILES} files`);
    if (off + size > buf.length) throw new Error("tar: truncated archive");
    const data = buf.subarray(off, off + size);
    if (size < PNG_SIGNATURE.length || !data.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`tar: ${name} is not a PNG`);
    files.push({ name, data });
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Validates the whole archive, then writes its files under `dir` only. Returns the written relative names. */
export function extractPngTar(buf, dir) {
  const files = parsePngTar(buf);
  const root = resolve(dir);
  const targets = files.map((f) => {
    const p = resolve(root, f.name);
    if (!p.startsWith(root + sep)) throw new Error(`tar: ${f.name} escapes the extraction folder`);
    return p;
  });
  files.forEach((f, i) => {
    mkdirSync(dirname(targets[i]), { recursive: true });
    writeFileSync(targets[i], f.data, { flag: "wx" });
  });
  return files.map((f) => f.name);
}
