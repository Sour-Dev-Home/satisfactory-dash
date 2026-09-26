import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-0031 PR 2: the boundary of the game-adapter package, enforced (the backend's architecture.test.ts checks the
 * other side). Production code here imports only its own files, node built-ins, zod and the bare
 * `@satisfactory-dash/shared`. No Express, no database, no backend path, and never a fixtures folder, so the edge
 * agent can lift the package as it is. Tests are not scanned: they may import fixtures.
 */

const ALLOWED_PACKAGES = [/^node:/, /^zod$/, /^@satisfactory-dash\/shared$/];

/** Every import specifier in a source file: static, re-export, side-effect, dynamic and require(). */
export function importSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const patterns = [
    /\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\b(?:import|require)\s*\(\s*["'`]([^"'`]+)["'`]\s*[,)]/g,
  ];
  return patterns.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[1]!));
}

/** Checks one file (a path relative to src/) against the boundary. Returns readable violations. */
export function findViolations(files: Map<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, source] of files) {
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith(".")) {
        const target = path.posix.join(path.posix.dirname(file), specifier);
        if (target.startsWith("..")) violations.push(`${file} imports "${specifier}": it leaves the package's src/ folder`);
        continue;
      }
      if (!ALLOWED_PACKAGES.some((allowed) => allowed.test(specifier))) {
        violations.push(`${file} imports "${specifier}": only node:, zod and the bare @satisfactory-dash/shared are allowed`);
      }
    }
  }
  return violations;
}

function readSources(): Map<string, string> {
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  const files = new Map<string, string>();
  for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    const relative = path.relative(srcDir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/");
    files.set(relative, readFileSync(path.join(entry.parentPath, entry.name), "utf8"));
  }
  return files;
}

describe("game-adapter package boundary", () => {
  it("production code imports only itself, node:, zod and the bare shared package", () => {
    const files = readSources();
    expect(files.size).toBeGreaterThan(8); // guards against the scan silently finding nothing
    expect(findViolations(files)).toEqual([]);
  });

  // The checker itself must be able to fail.
  const bad: [string, string, RegExp][] = [
    ["Express", `import express from "express";`, /only node:, zod/],
    ["a backend path", `import { a } from "../../../backend/src/platform/errors.js";`, /leaves the package/],
    ["a path out of src/", `import { a } from "../fixtures/rawFixtures.js";`, /leaves the package/],
    ["a shared subpath", `import { a } from "@satisfactory-dash/shared/fixtures";`, /only node:, zod/],
    ["a database driver", `import pg from "pg";`, /only node:, zod/],
    ["a dynamic import", `const m = await import("express");`, /only node:, zod/],
    ["require()", `const m = require("cors");`, /only node:, zod/],
    ["a re-export", `export * from "pino";`, /only node:, zod/],
    ["a multi-line import", `import {\n  a,\n} from "express";`, /only node:, zod/],
  ];
  it.each(bad)("fails on %s", (_name, source, expected) => {
    expect(findViolations(new Map([["x.ts", source]])).join("\n")).toMatch(expected);
  });

  it("accepts the allowed shapes", () => {
    const ok = new Map([
      ["x.ts", `import { z } from "zod";\nimport { readFileSync } from "node:fs";\nimport type { A } from "@satisfactory-dash/shared";\nimport { b } from "./b.js";`],
      ["sub/y.ts", `import { c } from "../c.js";`],
    ]);
    expect(findViolations(ok)).toEqual([]);
  });
});
