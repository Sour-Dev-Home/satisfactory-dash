import { FACTORY_BODY, FACTORY_BOUNDS, FACTORY_DOOR, FACTORY_WINDOWS, STATION_VIEWBOX, type RectShape } from "./stationShapes";

/*
 * The logo as a standalone SVG file (#444): the factory station (StationIcon `factory`, from the same
 * shapes in stationShapes.ts) on a canvas backdrop, coloured with the token values from index.css.
 * Build-time only: e2e/assets/icons.assets.ts (`npm run assets:icons -w frontend`) writes the favicon,
 * the app icons and the web manifest from it. The app itself draws the logo with StationIcon.
 */

export interface LogoColors {
  /** The backdrop and the windows (StationIcon's `fill-canvas`). */
  canvas: string;
  /** The steel body (`fill-surface-2`). */
  body: string;
  /** The body's outline (`stroke-muted`). */
  stroke: string;
  /** The lit door (`fill-accent`). */
  lit: string;
}

/** Every `--color-*` token in the `@theme` block, name (without `--color-`) to value. */
export function themeColors(css: string): Map<string, string> {
  const colors = new Map<string, string>();
  // The block ends at the first unindented closing brace (its @keyframes close indented).
  const theme = css.match(/@theme\s*\{([\s\S]*?)\r?\n\}/);
  for (const [, name, value] of theme?.[1].matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g) ?? []) {
    colors.set(name, value.trim());
  }
  return colors;
}

/** StationIcon's colours, from index.css. Throws on a missing or non-hex token: an icon file has no CSS. */
export function logoColors(css: string): LogoColors {
  const colors = themeColors(css);
  const hex = (token: string) => {
    const value = colors.get(token);
    if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--color-${token} must be a 6-digit hex colour, got ${value}`);
    return value.toLowerCase();
  };
  return { canvas: hex("canvas"), body: hex("surface-2"), stroke: hex("muted"), lit: hex("accent") };
}

/** How much of the icon the factory spans, so it keeps a margin on every side. */
const MARK_SPAN = 0.72;

const rect = ({ x, y, width, height, rx }: RectShape, fill: string) =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${fill}"/>`;

/** The logo's SVG markup: rounded for the favicon, square for the app icons (the platform rounds those). */
export function logoSvg(colors: LogoColors, { rounded = false }: { rounded?: boolean } = {}): string {
  const { left, top, right, bottom } = FACTORY_BOUNDS;
  const scale = (STATION_VIEWBOX * MARK_SPAN) / Math.max(right - left, bottom - top);
  const centre = STATION_VIEWBOX / 2;
  const tx = centre - ((left + right) / 2) * scale;
  const ty = centre - ((top + bottom) / 2) * scale;
  const round = (n: number) => Number(n.toFixed(4));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${STATION_VIEWBOX} ${STATION_VIEWBOX}">`,
    `<rect data-backdrop="" width="${STATION_VIEWBOX}" height="${STATION_VIEWBOX}" rx="${rounded ? 10 : 0}" fill="${colors.canvas}"/>`,
    `<g transform="translate(${round(tx)} ${round(ty)}) scale(${round(scale)})" stroke-linejoin="round">`,
    `<path d="${FACTORY_BODY}" fill="${colors.body}" stroke="${colors.stroke}" stroke-width="1.5"/>`,
    ...FACTORY_WINDOWS.map((pane) => rect(pane, colors.canvas)),
    rect(FACTORY_DOOR, colors.lit),
    `</g>`,
    `</svg>`,
  ].join("");
}

/** The files the icon script writes into public/, and which of them the web manifest lists. */
export const LOGO_ICONS = [
  { file: "icon-192.png", size: 192, manifest: true },
  { file: "icon-512.png", size: 512, manifest: true },
  { file: "apple-touch-icon.png", size: 180, manifest: false },
] as const;

/** public/site.webmanifest: the app's name, where it starts, and its icons. */
export function webManifest({ canvas }: Pick<LogoColors, "canvas">) {
  return {
    name: "Satis Manager",
    short_name: "Satis Manager",
    description: "A live dashboard for a Satisfactory dedicated server's power, production and status.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: canvas,
    theme_color: canvas,
    icons: LOGO_ICONS.filter((icon) => icon.manifest).map(({ file, size }) => ({
      src: `/${file}`,
      sizes: `${size}x${size}`,
      type: "image/png",
    })),
  };
}
