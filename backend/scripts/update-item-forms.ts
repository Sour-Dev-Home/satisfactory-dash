// Regenerates the committed item-form catalog (ADR-0015) from the game's own data:
//
//   npm run update-item-forms -w backend -- "<game install>/CommunityResources/Docs/en-US.json"
//   [--game-version 1.2.4.0]
//   (a path with spaces on Windows: set ITEM_DOCS_PATH instead of passing it as an argument)
//
// Writes backend/src/modules/telemetry/itemForms.generated.json with ONLY item class
// names and forms (never the Docs file itself) plus a header recording the game version
// and date. The game version is read from the install's *.version file when it can be
// found next to the Docs folder; pass --game-version to set it (or when it can't be).
// Run it after a game update and commit the diff; CI can't reach the game files.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeDocsFile, parseItemForms } from "../src/modules/telemetry/parseGameDocs.js";

const OUTPUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/modules/telemetry/itemForms.generated.json");

function detectGameVersion(docsFile: string): string | undefined {
  // <install>/CommunityResources/Docs/en-US.json -> <install>/Engine/Binaries/Win64/*.version
  const versionDir = path.join(path.dirname(docsFile), "..", "..", "Engine", "Binaries", "Win64");
  try {
    for (const name of readdirSync(versionDir).filter((f) => f.endsWith(".version"))) {
      const version = (JSON.parse(readFileSync(path.join(versionDir, name), "utf8")) as { GameVersion?: unknown }).GameVersion;
      if (typeof version === "string" && version !== "") {
        return version;
      }
    }
  } catch {
    // No version file there (another install layout): fall through.
  }
  return undefined;
}

const args = process.argv.slice(2);
const versionFlag = args.indexOf("--game-version");
const explicitVersion = versionFlag === -1 ? undefined : args[versionFlag + 1];
// The path can also come from ITEM_DOCS_PATH: on Windows, `npm run` mangles a path that
// contains spaces (e.g. "Program Files (x86)"), and an environment variable avoids that.
// Positional = not a flag and not the value right after --game-version. (With no flag,
// versionFlag is -1, so the value index must be excluded only when the flag exists.)
const docsFile =
  args.find((arg, i) => !arg.startsWith("--") && (versionFlag === -1 || i !== versionFlag + 1)) ?? process.env.ITEM_DOCS_PATH;
if (!docsFile) {
  console.error(
    'Usage: npm run update-item-forms -w backend -- "<path to CommunityResources/Docs/en-US.json>" [--game-version X]\n' +
      "       (or set ITEM_DOCS_PATH; do that if the path has spaces on Windows)",
  );
  process.exit(1);
}

const bytes = readFileSync(docsFile);
const forms = parseItemForms(JSON.parse(decodeDocsFile(bytes)));
const gameVersion = explicitVersion ?? detectGameVersion(docsFile);
if (!gameVersion) {
  console.error("Couldn't find the game version next to the Docs file; pass --game-version X.");
  process.exit(1);
}

const sorted = Object.fromEntries(Object.entries(forms).sort(([a], [b]) => a.localeCompare(b)));
const catalog = {
  meta: {
    gameVersion,
    generatedAt: new Date().toISOString().slice(0, 10),
    source: "CommunityResources/Docs/en-US.json",
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  },
  forms: sorted,
};
writeFileSync(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`);

const counts = Object.values(sorted).reduce<Record<string, number>>((acc, form) => ({ ...acc, [form]: (acc[form] ?? 0) + 1 }), {});
console.log(`Wrote ${Object.keys(sorted).length} items (${JSON.stringify(counts)}) for game version ${gameVersion}.`);
