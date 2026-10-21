import { describe, expect, it, vi } from "vitest";
import { addUnlessRemoved } from "./runtimeGuard.js";

// #526 (L2): the post-commit attach guard. The race itself runs against Postgres in selfServeOwner.db.test.ts.
describe("addUnlessRemoved", () => {
  it("keeps the entry of a live server", async () => {
    const runtime = { remove: vi.fn(async () => true) };
    const add = vi.fn(async () => {});
    await expect(addUnlessRemoved({ publicId: "s1", runtime, add, isLive: async () => true })).resolves.toBe(true);
    expect(add).toHaveBeenCalledOnce();
    expect(runtime.remove).not.toHaveBeenCalled();
  });

  it("removes the entry again when the server was removed meanwhile, re-reading only after the add", async () => {
    const order: string[] = [];
    const runtime = { remove: vi.fn(async (id: string) => order.push(`remove ${id}`)) };
    await expect(
      addUnlessRemoved({
        publicId: "s1",
        runtime,
        add: async () => void order.push("add"),
        isLive: async () => (order.push("read"), false),
      }),
    ).resolves.toBe(false);
    expect(order).toEqual(["add", "read", "remove s1"]);
  });
});
