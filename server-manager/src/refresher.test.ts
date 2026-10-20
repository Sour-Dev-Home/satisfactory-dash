import { describe, expect, it } from "vitest";
import { createRefresher } from "./refresher";

/** A read that waits until the test lets it finish, counting how many reads started. */
function gatedRead() {
  const releases: (() => void)[] = [];
  let started = 0;
  const read = () =>
    new Promise<void>((resolve) => {
      started++;
      releases.push(resolve);
    });
  const releaseNext = async () => {
    releases.shift()?.();
    // Let the refresher's own continuations run.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { read, releaseNext, started: () => started };
}

describe("createRefresher", () => {
  it("runs one read at a time: a plain refresh during a read joins it", async () => {
    const g = gatedRead();
    const refresh = createRefresher(g.read);
    const a = refresh();
    const b = refresh();
    expect(g.started()).toBe(1);
    await g.releaseNext();
    await Promise.all([a, b]);
    expect(g.started()).toBe(1);
  });

  it("a fresh refresh during a read waits for it, then reads again", async () => {
    const g = gatedRead();
    const refresh = createRefresher(g.read);
    void refresh();
    let freshDone = false;
    const fresh = refresh(true).then(() => {
      freshDone = true;
    });
    await g.releaseNext();
    expect(g.started()).toBe(2);
    expect(freshDone).toBe(false);
    await g.releaseNext();
    await fresh;
    expect(freshDone).toBe(true);
  });

  it("several fresh refreshes during one read share the one read after it", async () => {
    const g = gatedRead();
    const refresh = createRefresher(g.read);
    void refresh();
    const x = refresh(true);
    const y = refresh(true);
    await g.releaseNext();
    await g.releaseNext();
    await Promise.all([x, y]);
    expect(g.started()).toBe(2);
  });

  it("a fresh refresh with nothing running just reads", async () => {
    const g = gatedRead();
    const refresh = createRefresher(g.read);
    const p = refresh(true);
    expect(g.started()).toBe(1);
    await g.releaseNext();
    await p;
  });

  it("a failed read doesn't stop the next one", async () => {
    let calls = 0;
    const refresh = createRefresher(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    });
    await expect(refresh()).rejects.toThrow("boom");
    await refresh();
    expect(calls).toBe(2);
  });
});
