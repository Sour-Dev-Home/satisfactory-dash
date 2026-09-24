import { describe, it, expect, vi } from "vitest";
import { UpstreamError } from "../../../platform/errors.js";
import { NotEditableError } from "../../../platform/errorResponse.js";
import type { ServerOptionsPort } from "../../gameserver/index.js";
import { SettingsService } from "./settingsService.js";

/** A scripted game server: each read answers from the queue; the write can be made to fail. */
function port(over: { reads: (boolean | Error)[]; applyError?: unknown; editable?: boolean }) {
  const reads = [...over.reads];
  const options: ServerOptionsPort = {
    readAutoPause: vi.fn(async () => {
      const next = reads.shift();
      if (next === undefined) throw new Error("test read script exhausted");
      if (next instanceof Error) throw next;
      return { autoPause: next, pending: false };
    }),
    applyAutoPause: vi.fn(async () => {
      if (over.applyError !== undefined) throw over.applyError;
    }),
    canEditOptions: vi.fn(async () => over.editable ?? true),
  };
  return options;
}

const transport = () => new UpstreamError("Vanilla API request failed", { failureKind: "unreachable" });

describe("SettingsService.setAutoPause: a write whose response is lost", () => {
  it("reads back exactly once and reports the change as confirmed when the value is now the requested one", async () => {
    const options = port({ reads: [false, true], applyError: transport() });
    const applied = vi.fn();
    const result = await new SettingsService(options).setAutoPause(true, applied);
    expect(result).toEqual({ autoPause: true, pending: false, editable: true });
    expect(options.applyAutoPause).toHaveBeenCalledTimes(1);
    expect(options.readAutoPause).toHaveBeenCalledTimes(2); // the read before, and ONE read-back
    expect(applied).toHaveBeenCalledOnce();
    expect(applied).toHaveBeenCalledWith({ from: false, to: true, confirmedByReread: true });
  });

  it("rethrows the original transport error when the read-back shows the old value", async () => {
    const original = transport();
    const options = port({ reads: [false, false], applyError: original });
    const applied = vi.fn();
    await expect(new SettingsService(options).setAutoPause(true, applied)).rejects.toBe(original);
    expect(applied).not.toHaveBeenCalled();
    expect(options.readAutoPause).toHaveBeenCalledTimes(2);
  });

  it("rethrows the ORIGINAL error (not the read-back's) when the read-back fails too", async () => {
    const original = transport();
    const options = port({ reads: [false, new UpstreamError("down", { failureKind: "unreachable" })], applyError: original });
    const applied = vi.fn();
    await expect(new SettingsService(options).setAutoPause(true, applied)).rejects.toBe(original);
    expect(applied).not.toHaveBeenCalled();
  });

  it("swallows a read-back that throws something that is not an UpstreamError", async () => {
    const original = transport();
    const options = port({ reads: [false, new TypeError("a bug in the adapter")], applyError: original });
    await expect(new SettingsService(options).setAutoPause(true, vi.fn())).rejects.toBe(original);
  });

  it.each([
    ["an invalid_response", new UpstreamError("bad body", { failureKind: "invalid_response" })],
    ["a plain HTTP 500", new UpstreamError("failed with status 500", { status: 500 })],
    ["a plain HTTP 502", new UpstreamError("failed with status 502", { status: 502 })],
    ["an error that is not an UpstreamError", new Error("boom")],
    ["a non-Error rejection", "just a string"],
  ])("does not re-read after %s", async (_name, error) => {
    const options = port({ reads: [false, true], applyError: error });
    await expect(new SettingsService(options).setAutoPause(true, vi.fn())).rejects.toBe(error);
    expect(options.readAutoPause).toHaveBeenCalledTimes(1); // only the read before the write
  });

  it.each([401, 403])("still answers not_editable for a %s, without a read-back", async (status) => {
    const options = port({ reads: [false, true], applyError: new UpstreamError("refused", { status }) });
    await expect(new SettingsService(options).setAutoPause(true, vi.fn())).rejects.toBeInstanceOf(NotEditableError);
    expect(options.readAutoPause).toHaveBeenCalledTimes(1);
  });

  it("a clean write is unchanged: one write, the read before and one read after, no confirmedByReread", async () => {
    const options = port({ reads: [false, true] });
    const applied = vi.fn();
    const result = await new SettingsService(options).setAutoPause(true, applied);
    expect(result.autoPause).toBe(true);
    expect(options.applyAutoPause).toHaveBeenCalledTimes(1);
    expect(options.readAutoPause).toHaveBeenCalledTimes(2);
    expect(applied).toHaveBeenCalledWith({ from: false, to: true });
  });

  it("never writes to a server that is not editable", async () => {
    const options = port({ reads: [], editable: false });
    await expect(new SettingsService(options).setAutoPause(true, vi.fn())).rejects.toBeInstanceOf(NotEditableError);
    expect(options.applyAutoPause).not.toHaveBeenCalled();
  });

  it("does not let a throwing audit callback turn a landed write into a failure it can then re-read", async () => {
    // onApplied throwing is the caller's bug; the read-back path must not swallow it silently.
    const options = port({ reads: [false, true], applyError: transport() });
    const applied = vi.fn(() => {
      throw new Error("audit sink failed");
    });
    await expect(new SettingsService(options).setAutoPause(true, applied)).rejects.toThrow("audit sink failed");
  });
});
