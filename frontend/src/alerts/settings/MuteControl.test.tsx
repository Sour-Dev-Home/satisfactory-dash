import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MAX_MUTE_MS, toLocalInput } from "./muteTime";
import { MuteControl } from "./MuteControl";

// Fresh-eyes pass (ADR-0027 PR 9c): the mute form sends a local pick as a UTC instant, at most
// 7 days ahead, and must not double-fire its writes.

const NOW = new Date("2026-06-15T12:00:00.000Z").getTime();
const now = () => NOW;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("boundaries", () => {
  it("accepts exactly 7 days ahead", async () => {
    const onMute = vi.fn().mockResolvedValue(undefined);
    render(<MuteControl mutedUntil={null} onMute={onMute} onUnmute={async () => {}} now={now} />);
    fireEvent.change(screen.getByLabelText("Mute until"), { target: { value: toLocalInput(NOW + MAX_MUTE_MS) } });
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    await waitFor(() => expect(onMute).toHaveBeenCalledWith(new Date(NOW + MAX_MUTE_MS).toISOString()));
  });

  it("refuses an empty datetime value instead of throwing", () => {
    const onMute = vi.fn();
    render(<MuteControl mutedUntil={null} onMute={onMute} onUnmute={async () => {}} now={now} />);
    fireEvent.change(screen.getByLabelText("Mute until"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(screen.getByLabelText("Mute until")).toHaveAccessibleDescription("Choose a time in the future, at most 7 days ahead.");
    expect(onMute).not.toHaveBeenCalled();
  });
});

describe("double writes", () => {
  it("does not send a second mute when Mute is double-clicked before the first settles", async () => {
    const write = deferred<unknown>();
    const onMute = vi.fn().mockReturnValue(write.promise);
    render(<MuteControl mutedUntil={null} onMute={onMute} onUnmute={async () => {}} now={now} />);
    fireEvent.change(screen.getByLabelText("Mute until"), { target: { value: toLocalInput(NOW + 3_600_000) } });
    const button = screen.getByRole("button", { name: "Mute" });
    fireEvent.click(button);
    fireEvent.click(button);
    write.resolve(undefined);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(onMute).toHaveBeenCalledTimes(1);
  });

  it("does not send a second unmute when Unmute is double-clicked before it settles", async () => {
    const write = deferred<unknown>();
    const onUnmute = vi.fn().mockReturnValue(write.promise);
    render(<MuteControl mutedUntil={"2026-06-15T13:00:00.000Z"} onMute={async () => {}} onUnmute={onUnmute} now={now} />);
    const button = screen.getByRole("button", { name: "Unmute now" });
    fireEvent.click(button);
    fireEvent.click(button);
    write.resolve(undefined);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(onUnmute).toHaveBeenCalledTimes(1);
  });

  it("does not throw when onMute resolves after the component unmounts", async () => {
    const write = deferred<unknown>();
    const onMute = vi.fn().mockReturnValue(write.promise);
    const { unmount } = render(<MuteControl mutedUntil={null} onMute={onMute} onUnmute={async () => {}} now={now} />);
    fireEvent.change(screen.getByLabelText("Mute until"), { target: { value: toLocalInput(NOW + 3_600_000) } });
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    unmount();
    expect(() => write.resolve(undefined)).not.toThrow();
    await write.promise;
  });
});
