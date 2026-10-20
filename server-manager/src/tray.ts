/**
 * The tray icon's pure parts: its colour and tooltip for the server's state, the icon's pixels (drawn here, so there is
 * no image file to ship) and the menu's items. main.ts turns these into Electron's Tray and Menu.
 */
import { actionsFor } from "./renderer/view";
import type { ServerState } from "./supervisor";

export type TrayColour = "green" | "amber" | "red";

/** The dashboard's --color-ok, --color-warn and --color-bad (frontend/src/index.css; `tray.test.ts` keeps them equal). */
export const TRAY_RGB: Readonly<Record<TrayColour, string>> = Object.freeze({
  green: "#6fd49a",
  amber: "#e9c46a",
  red: "#ef5350",
});

/** 1x and 2x, for normal and high-DPI taskbars. */
export const TRAY_ICON_SIZES: readonly number[] = Object.freeze([16, 32]);

export function trayColour(state: ServerState): TrayColour {
  if (state === "running") return "green";
  if (state === "starting" || state === "stopping") return "amber";
  return "red";
}

export function trayTooltip(state: ServerState): string {
  return `Satisfactory server: ${state}`;
}

/** A filled, anti-aliased disc in `colour` on a transparent square, as raw BGRA (nativeImage.createFromBitmap). */
export function trayIconBitmap(colour: TrayColour, size: number): Buffer {
  const hex = (colour === "green" ? TRAY_RGB.green : colour === "amber" ? TRAY_RGB.amber : TRAY_RGB.red).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const buf = Buffer.alloc(size * size * 4);
  const centre = size / 2;
  const radius = size / 2 - size / 16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      const coverage = Math.max(0, Math.min(1, radius - d + 0.5));
      if (coverage === 0) continue;
      const at = (y * size + x) * 4;
      buf[at] = b;
      buf[at + 1] = g;
      buf[at + 2] = r;
      buf[at + 3] = Math.round(coverage * 255);
    }
  }
  return buf;
}

export type TrayItemId = "open" | "start" | "stop" | "restart" | "quit" | "stop-and-quit";

export type TrayItem = { id: TrayItemId; label: string; enabled: boolean } | { type: "separator" };

export interface TrayMenuInput {
  state: ServerState;
  configured: boolean;
  /** An update is running, or a leftover server couldn't be checked: the server actions wait, as in the window. */
  blocked: boolean;
}

export function trayMenu(input: TrayMenuInput): TrayItem[] {
  const actions = actionsFor(input.state, input.configured && !input.blocked);
  return [
    { id: "open", label: "Open", enabled: true },
    { type: "separator" },
    { id: "start", label: "Start", enabled: actions.start },
    { id: "stop", label: "Stop", enabled: actions.stop },
    { id: "restart", label: "Restart", enabled: actions.restart },
    { type: "separator" },
    { id: "quit", label: "Quit", enabled: true },
    { id: "stop-and-quit", label: "Stop server and quit", enabled: actions.stop },
  ];
}
