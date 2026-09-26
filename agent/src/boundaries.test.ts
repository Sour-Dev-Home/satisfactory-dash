import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-0031 PR 6: the boundary of the agent, enforced. Production code here imports only its own files, node built-ins, zod,
 * `@satisfactory-dash/shared` and `@satisfactory-dash/game-adapter` (bare, never a deep path and never the fixtures). No
 * Express, no database, no backend and no frontend path, and no network library beyond node's own `fetch`: the agent is
 * small and runs on a player's PC, so what it pulls in is part of what the player must trust. Tests and the test harness
 * (`*.test.ts`, `*.harness.ts`) are not scanned: they may import fixtures and vitest.
 */

const ALLOWED_PACKAGES = [/^node:/, /^zod$/, /^@satisfactory-dash\/shared$/, /^@satisfactory-dash\/game-adapter$/];

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

/** Checks files (paths relative to src/) against the boundary. Returns readable violations. */
export function findViolations(files: Map<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, source] of files) {
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith(".")) {
        if (path.posix.join(path.posix.dirname(file), specifier).startsWith("..")) violations.push(`${file} imports "${specifier}": it leaves the agent's src/ folder`);
        continue;
      }
      if (!ALLOWED_PACKAGES.some((allowed) => allowed.test(specifier))) {
        violations.push(`${file} imports "${specifier}": only node:, zod, and the bare @satisfactory-dash/shared and @satisfactory-dash/game-adapter are allowed`);
      }
    }
  }
  return violations;
}

function readSources(): Map<string, string> {
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  const files = new Map<string, string>();
  for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts") || entry.name.endsWith(".harness.ts")) continue;
    const relative = path.relative(srcDir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/");
    files.set(relative, readFileSync(path.join(entry.parentPath, entry.name), "utf8"));
  }
  return files;
}

describe("the agent's import boundary", () => {
  it("production code imports only node, zod, shared and game-adapter", () => {
    const files = readSources();
    expect(files.size).toBeGreaterThan(10); // the scan really found the sources
    expect(findViolations(files)).toEqual([]);
  });

  it("the checker itself catches what it should", () => {
    const bad = new Map([
      ["a.ts", 'import express from "express";\nimport pg from "pg";'],
      ["b.ts", 'import { x } from "@satisfactory-dash/shared/fixtures";'],
      ["c.ts", 'import { y } from "../../backend/src/x.js";'],
      ["d.ts", 'const z = await import("axios");'],
      ["e.ts", 'import { UpstreamError } from "@satisfactory-dash/game-adapter";\nimport { a } from "node:fs";\nimport { z } from "zod";\nimport { b } from "./b.js";'],
      ["f.ts", '// import x from "express"\n/* import y from "pg" */'],
    ]);
    const violations = findViolations(bad);
    expect(violations.map((line) => line.split(" ")[0])).toEqual(["a.ts", "a.ts", "b.ts", "c.ts", "d.ts"]);
  });

  it("no production file reads a token from the environment or the command line", () => {
    // Secrets come only from the DPAPI store or a hidden prompt (architect rule 3).
    const offenders: string[] = [];
    for (const [file, source] of readSources()) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/process\.env\.[A-Z_]*(TOKEN|SECRET|PASSWORD|KEY)/i.test(code)) offenders.push(`${file}: reads a secret from process.env`);
    }
    expect(offenders).toEqual([]);
  });
});
