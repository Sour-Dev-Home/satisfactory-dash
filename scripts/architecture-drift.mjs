#!/usr/bin/env node
// ADR-0024 phase 3: the architecture drift check.
//
// Compares the module-to-module imports of backend/src (found by dependency-cruiser) with
// the component relationships in docs-vault/workspace.dsl (the Backend API container, the
// BackendModulesFull view). An import edge the model doesn't show, or a modelled edge no
// import backs, fails the check. Component identity comes from the DSL property
// `"code" "modules/<name>" | "platform"`; the composition root (app.ts, server.ts) is the
// component with the id `root`.
//
// Usage: node scripts/architecture-drift.mjs   (from the repo root; exit 1 on drift)

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_SRC = "backend/src";
const API_PREFIX = "satis.api.";
const ROOT_ID = "root";
const ROOT_CODE = "root";
const ROOT_FILES = new Set(["app.ts", "server.ts"]);

/** DSL text -> { codes: Map<componentId, code>, edges: Set<"fromCode->toCode"> } for the
 *  components inside the Backend API container. */
export function parseWorkspace(rawDsl) {
  // Commented-out lines must not count: a commented relationship would otherwise still
  // "model" an edge, and a commented declaration would still define a component.
  const dsl = rawDsl
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .split(/\r?\n/)
    .map((line) => (/^\s*(\/\/|#)/.test(line) ? "" : line))
    .join("\n");
  const codes = new Map();
  const duplicates = [];
  const seenIds = new Set();
  let current = null;
  let depth = 0; // brace depth, so a later element's "code" is never given to the last component
  let currentDepth = 0;
  for (const line of dsl.split("\n")) {
    // Braces inside quoted strings (with \" escapes) or trailing // and # comments don't count.
    const braces = line.replace(/"(?:[^"\\]|\\.)*"/g, "").replace(/(\/\/|#).*$/, "");
    const opens = (braces.match(/\{/g) ?? []).length;
    const closes = (braces.match(/\}/g) ?? []).length;
    const declaration = line.match(/^\s*(\w+)\s*=\s*component\b/);
    if (declaration) {
      current = declaration[1];
      currentDepth = depth;
      if (seenIds.has(current)) {
        duplicates.push(`component id declared twice: ${current}`);
      }
      seenIds.add(current);
      if (current === ROOT_ID) {
        codes.set(current, ROOT_CODE);
      }
    } else {
      const code = line.match(/^\s*"code"\s+"([^"]+)"/);
      if (code && current) {
        if ([...codes].some(([id, c]) => c === code[1] && id !== current)) {
          duplicates.push(`code "${code[1]}" is mapped by more than one component`);
        }
        codes.set(current, code[1]);
      }
    }
    depth += opens - closes;
    if (current !== null && depth <= currentDepth) {
      current = null; // the component's block closed (or it had none)
    }
  }
  const edges = new Set();
  const unresolved = [];
  const relationship = /^\s*([\w.]+)\s*->\s*([\w.]+)\b/;
  for (const line of dsl.split("\n")) {
    const match = line.match(relationship);
    if (!match || !match[1].startsWith(API_PREFIX) || !match[2].startsWith(API_PREFIX)) {
      continue;
    }
    const [from, to] = [match[1].slice(API_PREFIX.length), match[2].slice(API_PREFIX.length)];
    if (!codes.has(from) || !codes.has(to)) {
      unresolved.push(`${match[1]} -> ${match[2]}`);
      continue;
    }
    edges.add(`${codes.get(from)}->${codes.get(to)}`);
  }
  return { codes, edges, unresolved, duplicates };
}

/** Relative specifiers of `export type { X } from "..."` / `export type * from "..."`.
 *  dependency-cruiser does not report these type-only re-exports, so they are scanned here. */
export function typeOnlyReExports(text) {
  const found = [];
  const re = /\bexport\s+type\s*(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s*from\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(re)) {
    if (match[1].startsWith(".")) {
      found.push(match[1]);
    }
  }
  return found;
}

/** Components that have source files but no `code` mapping in the model, and vice versa. */
export function compareComponents(modelCodes, codeComponents) {
  const lines = [];
  const modelled = new Set(modelCodes);
  for (const c of [...codeComponents].sort()) {
    if (!modelled.has(c)) {
      lines.push(`component in code, not in workspace.dsl: ${c}`);
    }
  }
  for (const c of [...modelled].sort()) {
    if (!codeComponents.has(c)) {
      lines.push(`component in workspace.dsl, no source files in code: ${c}`);
    }
  }
  return lines;
}

/** "backend/src/modules/telemetry/x.ts" -> "modules/telemetry"; platform files -> "platform";
 *  app.ts / server.ts -> "root"; anything else -> null (not covered by the model). */
export function componentOf(file) {
  const rel = file.replaceAll("\\", "/").replace(`${BACKEND_SRC}/`, "");
  const module = rel.match(/^modules\/([^/]+)\//);
  if (module) {
    return `modules/${module[1]}`;
  }
  if (rel.startsWith("platform/")) {
    return "platform";
  }
  return ROOT_FILES.has(rel) ? ROOT_CODE : null;
}

/** dependency-cruiser modules -> { edges: Set<"fromCode->toCode">, problems: string[] } */
export function codeEdges(cruisedModules) {
  const edges = new Set();
  const problems = [];
  for (const mod of cruisedModules) {
    if (!mod.source.replaceAll("\\", "/").startsWith(`${BACKEND_SRC}/`)) {
      continue; // built-ins and packages appear as modules too; only backend sources are components
    }
    const from = componentOf(mod.source);
    if (from === null) {
      problems.push(`${mod.source} belongs to no modelled component`);
      continue;
    }
    for (const dep of mod.dependencies) {
      if (dep.couldNotResolve) {
        if (!dep.module.startsWith(".")) {
          continue; // a package subpath (e.g. "dotenv/config") that has no source to classify
        }
        problems.push(`${mod.source}: could not resolve "${dep.module}"`);
        continue;
      }
      const resolved = dep.resolved.replaceAll("\\", "/");
      if (!resolved.startsWith(`${BACKEND_SRC}/`)) {
        continue; // node built-ins, npm packages and the shared contract are not components
      }
      const to = componentOf(resolved);
      if (to === null) {
        problems.push(`${mod.source} imports ${resolved}, which belongs to no modelled component`);
      } else if (to !== from) {
        edges.add(`${from}->${to}`);
      }
    }
  }
  return { edges, problems };
}

/** The drift between the modelled edges and the imported ones, as human-readable lines. */
export function compareEdges(modelled, imported) {
  const lines = [];
  for (const edge of [...imported].sort()) {
    if (!modelled.has(edge)) {
      lines.push(`unknown edge (imported in code, not in workspace.dsl): ${edge}`);
    }
  }
  for (const edge of [...modelled].sort()) {
    if (!imported.has(edge)) {
      lines.push(`missing edge (in workspace.dsl, no import backs it): ${edge}`);
    }
  }
  return lines;
}

/** A pass must mean something: an empty model, an empty cruise or no edges at all (e.g. a DSL
 *  format change plus a cruise that found nothing) would otherwise print "matches: 0". */
export function vacuityProblems({ componentCount, modelEdgeCount, codeEdgeCount, cruisedSources }) {
  const problems = [];
  if (componentCount === 0) {
    problems.push('vacuous check: workspace.dsl yielded no components with a "code" property');
  }
  if (modelEdgeCount === 0) {
    problems.push("vacuous check: workspace.dsl yielded no relationships between Backend API components");
  }
  if (codeEdgeCount === 0) {
    problems.push("vacuous check: no module-to-module imports were found in backend/src");
  }
  if (!cruisedSources.some((source) => source.replaceAll("\\", "/").startsWith(`${BACKEND_SRC}/`))) {
    problems.push(`vacuous check: dependency-cruiser returned no ${BACKEND_SRC} files`);
  }
  return problems;
}

function productionFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__fixtures__" || entry.name === "node_modules" ? [] : productionFiles(full);
    }
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
  });
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.chdir(root);
  const { cruise } = await import("dependency-cruiser");
  // A directory argument yields no modules here, so list the production files explicitly.
  const { output } = await cruise(productionFiles(BACKEND_SRC), {
    tsPreCompilationDeps: true, // type-only imports are still dependencies
    tsConfig: { fileName: "backend/tsconfig.json" },
    exclude: { path: String.raw`\.test\.ts$|__fixtures__|node_modules` },
  },
  // The sources import "./x.js" for files named x.ts (moduleResolution "bundler").
  { extensions: [".ts", ".js"], extensionAlias: { ".js": [".ts", ".js"] } });

  const model = parseWorkspace(readFileSync("docs-vault/workspace.dsl", "utf8"));
  const files = productionFiles(BACKEND_SRC);
  const extra = files.map((file) => ({
    source: file,
    dependencies: typeOnlyReExports(readFileSync(file, "utf8")).map((spec) => {
      const base = path.posix.join(path.posix.dirname(file), spec.replace(/\.js$/, ""));
      const resolved = [`${base}.ts`, `${base}/index.ts`].find((candidate) => existsSync(candidate));
      return resolved ? { module: spec, resolved } : { module: spec, couldNotResolve: true };
    }),
  }));
  const code = codeEdges([...output.modules, ...extra]);
  const codeComponents = new Set(files.map(componentOf).filter((c) => c !== null));
  const problems = [
    ...vacuityProblems({
      componentCount: model.codes.size,
      modelEdgeCount: model.edges.size,
      codeEdgeCount: code.edges.size,
      cruisedSources: output.modules.map((m) => m.source),
    }),
    ...model.unresolved.map((r) => `workspace.dsl relationship names a component without a "code" property: ${r}`),
    ...model.duplicates.map((d) => `workspace.dsl: ${d}`),
    ...new Set(code.problems),
    ...compareComponents(model.codes.values(), codeComponents),
    ...compareEdges(model.edges, code.edges),
  ];
  if (problems.length > 0) {
    console.error(`Architecture drift (${problems.length}):\n- ${problems.join("\n- ")}`);
    console.error("Update docs-vault/workspace.dsl (and the D2 files it drives) or the code, in the same PR.");
    process.exit(1);
  }
  console.log(`Architecture matches: ${code.edges.size} module edges in code and in workspace.dsl.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
