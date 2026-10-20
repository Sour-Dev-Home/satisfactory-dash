import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { LOGO_ICONS, logoColors, logoSvg, webManifest } from "../../src/ui/logoMark";

// `npm run assets:icons -w frontend` (#444): the favicon, the app icons and the web manifest, all
// from one source, the logo SVG (src/ui/logoMark.ts: StationIcon's factory in index.css's colours).
// Rerun it when the factory shapes or those tokens change, and commit what it writes.
const ROOT = join(import.meta.dirname, "..", "..");
const PUBLIC = join(ROOT, "public");
const colors = logoColors(readFileSync(join(ROOT, "src", "index.css"), "utf8"));

test("favicon and manifest", () => {
  writeFileSync(join(PUBLIC, "favicon.svg"), `${logoSvg(colors, { rounded: true })}\n`);
  writeFileSync(join(PUBLIC, "site.webmanifest"), `${JSON.stringify(webManifest(colors), null, 2)}\n`);
});

for (const { file, size } of LOGO_ICONS) {
  test(file, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${logoSvg(colors)}`,
    );
    const png = await page.screenshot({ path: join(PUBLIC, file), omitBackground: true });
    // PNG's IHDR holds the width and height at bytes 16-23.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
    await page.close();
  });
}
