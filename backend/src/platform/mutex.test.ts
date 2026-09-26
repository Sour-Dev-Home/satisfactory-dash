import { describe, expect, it } from "vitest";
import { Mutex } from "./mutex.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Mutex", () => {
  it("runs callbacks one at a time, in call order, without overlap", async () => {
    const mutex = new Mutex();
    const events: string[] = [];
    const job = (name: string, ms: number) => async () => {
      events.push(`start ${name}`);
      await sleep(ms);
      events.push(`end ${name}`);
      return name;
    };
    const results = await Promise.all([mutex.run(job("a", 20)), mutex.run(job("b", 1)), mutex.run(job("c", 5))]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(events).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("a failing callback releases the lock and only its own caller sees the error", async () => {
    const mutex = new Mutex();
    const failing = mutex.run(async () => {
      throw new Error("boom");
    });
    const next = mutex.run(async () => "fine");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("fine");
    await expect(mutex.run(async () => "still works")).resolves.toBe("still works");
  });

  it("a callback that throws synchronously is contained too", async () => {
    const mutex = new Mutex();
    await expect(mutex.run(() => { throw new Error("sync"); })).rejects.toThrow("sync");
    await expect(mutex.run(async () => 1)).resolves.toBe(1);
  });
});
