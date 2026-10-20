/**
 * The Overview still under the hero (#444): rendered from the built demo by
 * e2e/assets/preview.assets.ts (`npm run assets:preview -w frontend`), so it shows the real app.
 * Its size is fixed here so the page reserves its box before it loads: nothing moves when it arrives.
 * The script checks the file it writes has this size.
 */
export const PREVIEW = {
  src: "/overview-preview.png",
  // The app's column at desktop width (max-w-6xl at the 15 px root size), from the tab row down.
  width: 1080,
  height: 640,
  alt:
    "The Satis Manager Overview on the demo's made-up factory: health operational; the server, power and " +
    "factory stations, with two machines backed up; three of four players connected; and power use against capacity.",
} as const;
