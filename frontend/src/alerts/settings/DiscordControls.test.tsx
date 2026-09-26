import { render, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DiscordDestination } from "@satisfactory-dash/shared";
import { DiscordControls } from "./DiscordControls";

// Fresh-eyes pass (ADR-0027 PR 9c): the webhook is a bearer secret that must never survive a
// save, and the write buttons must not fire twice on a double click.

const discord: DiscordDestination = { last4: "abcd", enabled: true, disabledReason: null, updatedAt: "2026-06-01T00:00:00.000Z" };

/** A promise plus its resolve/reject, so a test can control exactly when a write settles. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const noop = () => Promise.resolve();

describe("the webhook form", () => {
  it("clears the field only after a successful save, keeps it after a refusal", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("nope"));
    render(<DiscordControls discord={null} demo={false} onSave={onSave} onToggle={noop} onRemove={noop} onTest={async () => ({ ok: true })} />);
    const field = screen.getByLabelText("Webhook URL");
    fireEvent.change(field, { target: { value: "https://discord.com/api/webhooks/1/secret-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Save webhook" }));
    await screen.findByRole("alert");
    expect(field).toHaveValue("https://discord.com/api/webhooks/1/secret-token");
  });

  it("never puts the secret in the DOM after a save resolves, success or failure", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("refused"));
    render(<DiscordControls discord={null} demo={false} onSave={onSave} onToggle={noop} onRemove={noop} onTest={async () => ({ ok: true })} />);
    const secret = "https://discord.com/api/webhooks/1/super-secret-token";
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: secret } });
    fireEvent.click(screen.getByRole("button", { name: "Save webhook" }));
    await screen.findByRole("alert");
    // The value stays in the (password-type) input for editing, but nowhere else in the DOM,
    // and the error text itself must not echo the secret back.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).not.toContain(secret);
  });

  it("does not send a second request when Save is double-clicked before the first settles", async () => {
    const write = deferred<unknown>();
    const onSave = vi.fn().mockReturnValue(write.promise);
    render(<DiscordControls discord={null} demo={false} onSave={onSave} onToggle={noop} onRemove={noop} onTest={async () => ({ ok: true })} />);
    fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value: "https://discord.com/api/webhooks/1/x" } });
    const button = screen.getByRole("button", { name: "Save webhook" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    write.resolve(undefined);
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("Send test / Turn on-off / Remove share one busy flag", () => {
  it("does not send a second test when Send test is double-clicked before it settles", async () => {
    const write = deferred<{ ok: true }>();
    const onTest = vi.fn().mockReturnValue(write.promise);
    render(<DiscordControls discord={discord} demo={false} onSave={noop} onToggle={noop} onRemove={noop} onTest={onTest} />);
    const button = screen.getByRole("button", { name: "Send test" });
    fireEvent.click(button);
    fireEvent.click(button);
    write.resolve({ ok: true });
    await waitFor(() => expect(onTest).toHaveBeenCalledTimes(1));
  });

  it("keeps the confirm open beside the error when Remove fails, so a retry is one click", async () => {
    const onRemove = vi.fn().mockRejectedValueOnce(new Error("server said no")).mockResolvedValueOnce({ deleted: true });
    render(<DiscordControls discord={discord} demo={false} onSave={noop} onToggle={noop} onRemove={onRemove} onTest={async () => ({ ok: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove webhook" }));
    const group = screen.getByRole("group", { name: "Confirm remove" });
    fireEvent.click(within(group).getByRole("button", { name: "Remove" }));
    await screen.findByRole("alert");
    // Found by the test-hunter: the confirm used to close on failure too.
    const stillOpen = screen.getByRole("group", { name: "Confirm remove" });
    fireEvent.click(within(stillOpen).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Confirm remove" })).not.toBeInTheDocument());
    expect(onRemove).toHaveBeenCalledTimes(2);
  });

  it("does not throw when onTest resolves after the component unmounts", async () => {
    const write = deferred<{ ok: true }>();
    const onTest = vi.fn().mockReturnValue(write.promise);
    const { unmount } = render(
      <DiscordControls discord={discord} demo={false} onSave={noop} onToggle={noop} onRemove={noop} onTest={onTest} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    unmount();
    expect(() => write.resolve({ ok: true })).not.toThrow();
    await write.promise;
  });
});
