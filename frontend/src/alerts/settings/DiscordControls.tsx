import { useId, useState, type FormEvent } from "react";
import type { DiscordDestination } from "@satisfactory-dash/shared";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../rules/FormField";
import { fieldAttrs } from "../rules/fieldAttrs";
import { sendTestText } from "../alertText";

type SendTestAnswer = { ok: true } | { ok: false; code: string };

/** One write in flight and its failure, for a button that shows either. */
function useWrite() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const run = async <T,>(write: () => Promise<T>): Promise<T | undefined> => {
    setFailure(null);
    setBusy(true);
    try {
      return await write();
    } catch (e) {
      setFailure(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, failure, run };
}

/**
 * The Discord destination's owner/admin controls (ADR-0027 decision 5): set or replace the webhook,
 * turn it off or on, send a test, remove it. The webhook URL is a bearer secret: it lives only in
 * this form's input, goes out through `onSave` (the container's saveWebhook, never a mutation's
 * variables), and the field is cleared once it's saved. It is never shown again, only its last 4.
 */
export function DiscordControls({
  discord,
  demo,
  onSave,
  onToggle,
  onRemove,
  onTest,
}: {
  discord: DiscordDestination | null;
  /** The demo build: "Send test" answers without a network call, and says so. */
  demo: boolean;
  onSave: (webhookUrl: string) => Promise<unknown>;
  onToggle: (enabled: boolean) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
  onTest: () => Promise<SendTestAnswer>;
}) {
  const id = useId();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string>();
  const [tested, setTested] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const save = useWrite();
  const other = useWrite();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (url.trim() === "") {
      setError("Paste the webhook URL from Discord.");
      return;
    }
    setError(undefined);
    setTested(null);
    const saved = await save.run(() => onSave(url.trim()));
    // Only on success: after a refusal the user fixes the URL they typed rather than retyping it.
    if (saved !== undefined) setUrl("");
  }

  async function test() {
    setTested(null);
    const answer = await other.run(onTest);
    if (answer) setTested(sendTestText(answer, demo));
  }

  const hint = "In Discord: channel settings, Integrations, Webhooks. Only its last 4 characters are shown again.";
  return (
    <div className="grid gap-4">
      {discord && (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={other.busy} onClick={() => void test()}>
              Send test
            </button>
            <button type="button" disabled={other.busy} onClick={() => void other.run(() => onToggle(!discord.enabled))}>
              {discord.enabled ? "Turn off" : "Turn on"}
            </button>
            {confirming ? (
              <span role="group" aria-label="Confirm remove" className="flex flex-wrap items-center gap-2 text-sm">
                Remove this webhook?
                <button
                  type="button"
                  disabled={other.busy}
                  onClick={() => void other.run(onRemove).then(() => setConfirming(false))}
                >
                  Remove
                </button>
                <button type="button" disabled={other.busy} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" disabled={other.busy} onClick={() => setConfirming(true)}>
                Remove webhook
              </button>
            )}
          </div>
          {tested && (
            <p role="status" className="mb-0 text-sm">
              {tested}
            </p>
          )}
          {other.failure !== null && <ErrorNotice error={other.failure} />}
        </div>
      )}

      <form onSubmit={submit} noValidate aria-label="Discord webhook" className="grid gap-3">
        <div className="max-w-xl">
          <FormField id={`${id}-url`} label={discord ? "New webhook URL" : "Webhook URL"} hint={hint} error={error}>
            {/* A password field: the URL is a secret, so it isn't shown on screen or kept by the browser. */}
            <input
              {...fieldAttrs(`${id}-url`, hint, error)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </FormField>
        </div>
        <div>
          <button type="submit" disabled={save.busy}>
            {save.busy ? "Saving…" : discord ? "Replace webhook" : "Save webhook"}
          </button>
        </div>
        {save.failure !== null && <ErrorNotice error={save.failure} />}
      </form>
    </div>
  );
}
