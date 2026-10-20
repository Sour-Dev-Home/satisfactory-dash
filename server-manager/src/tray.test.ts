import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ServerState } from "./supervisor";
import { TRAY_ICON_SIZES, TRAY_RGB, trayColour, trayIconBitmap, trayMenu, trayTooltip, type TrayMenuInput } from "./tray";

const STATES: ServerState[] = ["stopped", "starting", "running", "stopping", "crashed"];

describe("trayColour", () => {
  it("is green running, amber starting or stopping, red stopped or crashed", () => {
    expect(STATES.map(trayColour)).toEqual(["red", "amber", "green", "amber", "red"]);
  });

  it("uses the dashboard's ok, warn and bad tokens", () => {
    const css = readFileSync(new URL("../../frontend/src/index.css", import.meta.url), "utf8");
    const token = (name: string) => new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})\\s*;`, "i").exec(css)?.[1]?.toLowerCase();
    expect(TRAY_RGB).toEqual({ green: token("ok"), amber: token("warn"), red: token("bad") });
  });
});

describe("trayTooltip", () => {
  it("names the state", () => {
    for (const state of STATES) expect(trayTooltip(state)).toContain(state);
    expect(trayTooltip("running")).toBe("Satisfactory server: running");
  });
});

describe("trayIconBitmap", () => {
  const px = (buf: Buffer, size: number, x: number, y: number) => [...buf.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];

  it("is a BGRA disc in the state's colour on a transparent square, at each size", () => {
    expect(TRAY_ICON_SIZES).toEqual([16, 32]);
    for (const size of TRAY_ICON_SIZES) {
      const buf = trayIconBitmap("green", size);
      expect(buf.length).toBe(size * size * 4);
      const hex = TRAY_RGB.green.slice(1);
      const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      expect(px(buf, size, size / 2, size / 2)).toEqual([b, g, r, 255]);
      expect(px(buf, size, 0, 0)[3]).toBe(0);
    }
  });

  it("differs per colour", () => {
    const a = trayIconBitmap("green", 16);
    expect(a.equals(trayIconBitmap("red", 16))).toBe(false);
    expect(a.equals(trayIconBitmap("amber", 16))).toBe(false);
  });
});

describe("trayMenu", () => {
  const base: TrayMenuInput = { state: "stopped", configured: true, blocked: false };
  const labels = (input: TrayMenuInput) => trayMenu(input).map((i) => ("label" in i ? i.label : "-"));
  const enabled = (input: TrayMenuInput) =>
    Object.fromEntries(trayMenu(input).flatMap((i) => ("id" in i ? [[i.id, i.enabled]] : [])));

  it("is Open, Start, Stop, Restart, then Quit and Stop server and quit", () => {
    expect(labels(base)).toEqual(["Open", "-", "Start", "Stop", "Restart", "-", "Quit", "Stop server and quit"]);
  });

  it("enables Start, Stop and Restart as the window's buttons do", () => {
    expect(enabled(base)).toMatchObject({ open: true, start: true, stop: false, restart: false, quit: true });
    expect(enabled({ ...base, state: "running" })).toMatchObject({ start: false, stop: true, restart: true });
    expect(enabled({ ...base, state: "starting" })).toMatchObject({ start: false, stop: true, restart: false });
    expect(enabled({ ...base, state: "stopping" })).toMatchObject({ start: false, stop: false, restart: false });
    expect(enabled({ ...base, state: "crashed" })).toMatchObject({ start: true, stop: false, restart: false });
  });

  it("offers no server action while unconfigured, updating or blocked by an unverified leftover", () => {
    for (const input of [{ ...base, configured: false }, { ...base, blocked: true, state: "running" as const }]) {
      expect(enabled(input)).toMatchObject({ open: true, start: false, stop: false, restart: false, quit: true });
    }
  });

  it("offers Stop server and quit only when there is a server to stop", () => {
    expect(enabled(base)["stop-and-quit"]).toBe(false);
    expect(enabled({ ...base, state: "running" })["stop-and-quit"]).toBe(true);
    expect(enabled({ ...base, state: "starting" })["stop-and-quit"]).toBe(true);
    expect(enabled({ ...base, state: "running", blocked: true })["stop-and-quit"]).toBe(false);
  });
});
