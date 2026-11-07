import { afterEach, describe, expect, it, vi } from "vitest";
import { isTypingField, pressTarget, tabStopOf, watchDone } from "./tryIt";

const html = (markup: string) => {
  document.body.innerHTML = markup;
};
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("watchDone: appears", () => {
  it("fires once when an element with that data-tour appears later", async () => {
    html(`<div id="host"></div>`);
    const onDone = vi.fn();
    watchDone({ appears: "panel" }, onDone);
    await flush();
    expect(onDone).not.toHaveBeenCalled();
    document.getElementById("host")!.innerHTML = `<aside data-tour="panel"></aside>`;
    await flush();
    expect(onDone).toHaveBeenCalledTimes(1);
    document.getElementById("host")!.innerHTML += `<aside data-tour="panel"></aside>`;
    await flush();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not count one already there when the watch began (Back onto a step whose panel is still open)", async () => {
    html(`<aside data-tour="panel"></aside><p id="other"></p>`);
    const onDone = vi.fn();
    watchDone({ appears: "panel" }, onDone);
    document.getElementById("other")!.textContent = "changed";
    document.body.append(document.createElement("div"));
    await flush();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("calls nothing after it is stopped", async () => {
    html(`<div id="host"></div>`);
    const onDone = vi.fn();
    const stop = watchDone({ appears: "panel" }, onDone);
    stop();
    document.getElementById("host")!.innerHTML = `<aside data-tour="panel"></aside>`;
    await flush();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("watchDone: changes", () => {
  it("fires on a change inside the target, even when a page handler stops it, and not on a change elsewhere", () => {
    html(`<label data-tour="toggle"><input id="mine" type="checkbox"> Belts</label><input id="other" type="checkbox">`);
    document.getElementById("mine")!.addEventListener("change", (e) => e.stopPropagation());
    const onDone = vi.fn();
    watchDone({ changes: "toggle" }, onDone);
    document.getElementById("other")!.click();
    expect(onDone).not.toHaveBeenCalled();
    document.getElementById("mine")!.click();
    expect(onDone).toHaveBeenCalledTimes(1);
    document.getElementById("mine")!.click();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("never fires when nothing changes, and stops listening when stopped", () => {
    html(`<input data-tour="toggle" type="checkbox">`);
    const onDone = vi.fn();
    const stop = watchDone({ changes: "toggle" }, onDone);
    stop();
    document.querySelector<HTMLInputElement>("input")!.click();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("pressTarget (Do it for me)", () => {
  it("dispatches a bubbling click that reaches a handler on an SVG <g> (which has no .click())", () => {
    html(`<svg><g id="card"><rect width="10" height="10"></rect></g></svg>`);
    const onBubble = vi.fn();
    document.body.addEventListener("click", onBubble);
    const card = document.getElementById("card")!;
    const onClick = vi.fn();
    card.addEventListener("click", onClick);
    pressTarget(card);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onBubble).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("click", onBubble);
  });

  it("ticks a label's checkbox through its control, firing change as a real tick does", () => {
    html(`<label id="l"><input type="checkbox"> Belts</label>`);
    const box = document.querySelector("input")!;
    const onChange = vi.fn();
    box.addEventListener("change", onChange);
    pressTarget(document.getElementById("l")!);
    expect(box.checked).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("tabStopOf", () => {
  it("is the target when it takes focus, else what inside it does, else the named keyboard path", () => {
    html(`<button id="b">B</button><label id="l"><input id="i" type="checkbox"></label><svg><g id="g"></g></svg><button data-tour="key" class="sr-only">Card</button>`);
    expect(tabStopOf(document.getElementById("b")!)).toBe(document.getElementById("b"));
    expect(tabStopOf(document.getElementById("l")!)).toBe(document.getElementById("i"));
    expect(tabStopOf(document.getElementById("g")!)).toBeNull();
    expect(tabStopOf(document.getElementById("g")!, "key")).toBe(document.querySelector('[data-tour="key"]'));
  });
});

describe("isTypingField", () => {
  it("is a text field, a select, a textarea or editable text, not a checkbox or a button", () => {
    html(`<input id="t"><input id="c" type="checkbox"><textarea id="a"></textarea><select id="s"></select><button id="b"></button>`);
    const at = (id: string) => document.getElementById(id);
    expect(isTypingField(at("t"))).toBe(true);
    expect(isTypingField(at("a"))).toBe(true);
    expect(isTypingField(at("s"))).toBe(true);
    expect(isTypingField(at("c"))).toBe(false);
    expect(isTypingField(at("b"))).toBe(false);
  });
});
