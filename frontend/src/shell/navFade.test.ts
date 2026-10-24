import { afterEach, describe, expect, it, vi } from "vitest";
import { navFadeClass, revealActiveTab } from "./navFade";

afterEach(() => vi.unstubAllGlobals());

describe("navFadeClass", () => {
  it("fades nothing when the tabs fit", () => {
    expect(navFadeClass(0, 390, 390)).toBe("");
    expect(navFadeClass(0, 390, 390.5)).toBe("");
  });
  it("fades the end while there is more ahead, the start once scrolled, both between", () => {
    expect(navFadeClass(0, 390, 520)).toBe("max-sm:nav-fade-end");
    expect(navFadeClass(60, 390, 520)).toBe("max-sm:nav-fade-both");
    expect(navFadeClass(130, 390, 520)).toBe("max-sm:nav-fade-start");
    expect(navFadeClass(129.5, 390, 520)).toBe("max-sm:nav-fade-start");
  });
  it("only ever names a phone-only class, so the desktop nav is untouched", () => {
    for (const x of [0, 50, 130]) expect(navFadeClass(x, 390, 520)).toMatch(/^max-sm:/);
  });
});

describe("revealActiveTab", () => {
  const navWith = () => {
    const nav = document.createElement("nav");
    nav.innerHTML = '<a href="/a">A</a><a href="/b" aria-current="page">B</a>';
    const active = nav.querySelector<HTMLElement>("[aria-current]")!;
    active.scrollIntoView = vi.fn();
    return { nav, active };
  };
  it("scrolls the active tab into view, nearest, smoothly", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { nav, active } = navWith();
    revealActiveTab(nav);
    expect(active.scrollIntoView).toHaveBeenCalledWith({ inline: "nearest", block: "nearest", behavior: "smooth" });
  });
  it("jumps instead under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { nav, active } = navWith();
    revealActiveTab(nav);
    expect(active.scrollIntoView).toHaveBeenCalledWith({ inline: "nearest", block: "nearest", behavior: "auto" });
  });
  it("does nothing without a nav or an active tab", () => {
    expect(() => revealActiveTab(null)).not.toThrow();
    expect(() => revealActiveTab(document.createElement("nav"))).not.toThrow();
  });
});
