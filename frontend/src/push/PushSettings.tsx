import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePushWrites } from "../api/pushWrites";
import { ApiError } from "../api/errors";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { Loadable, Skeleton, SkeletonStatus } from "../ui/Skeleton";
import { useSelectedServer } from "../servers/ServerContext";
import {
  currentSubscription,
  enableDevice,
  notificationPermission,
  pushSupport,
  subscriptionBody,
} from "./pushBrowser";
import { DENIED_TEXT, DISABLED_TEXT, DISMISSED_TEXT, IOS_TEXT, SUBSCRIBE_FAILED_TEXT, UNSUPPORTED_TEXT, pushTestText } from "./pushText";

/**
 * Settings → Alerts → "Push notifications on this device" (ADR-0044, #348). Whether push is on at all comes
 * from the backend; this device's state comes from the browser (permission and subscription); the per-server
 * opt-in is the member's own, so every role gets it. Permission is asked only on the Turn on click.
 */
export function PushSettings() {
  const config = useQuery(queries.pushConfig());
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="grid gap-3">
      <h4 id={id} className="mb-0">
        Push notifications on this device
      </h4>
      <Loadable pending={config.isPending} skeleton={<PushSkeleton label="Loading the push setup…" />} className="grid gap-3">
        {!config.data ? (
          <ErrorNotice
            error={config.error}
            action={
              <button type="button" onClick={() => void config.refetch()}>
                Retry
              </button>
            }
          />
        ) : config.data.enabled && config.data.vapidPublicKey ? (
          <PushControls vapidPublicKey={config.data.vapidPublicKey} />
        ) : (
          <p className="mb-0 text-muted">{DISABLED_TEXT}</p>
        )}
      </Loadable>
    </div>
  );
}

function PushSkeleton({ label }: { label: string }) {
  return (
    <div className="grid gap-3">
      <SkeletonStatus>{label}</SkeletonStatus>
      <Skeleton className="h-lh w-64" />
      <Skeleton className="h-touch w-40" />
    </div>
  );
}

type Device =
  | { kind: "checking" }
  | { kind: "ios" | "unsupported" | "denied" | "off" }
  | { kind: "on"; id?: string };

/** One write in flight and its failure, for the buttons that show either. */
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

function PushControls({ vapidPublicKey }: { vapidPublicKey: string }) {
  const server = useSelectedServer();
  const writes = usePushWrites(server.id);
  const [device, setDevice] = useState<Device>({ kind: "checking" });
  // The result of the last action, read out by the live region.
  const [note, setNote] = useState<string | null>(null);
  const work = useWrite();
  // Turning on or off swaps the buttons, which drops the focus the click had: put it on the new first button.
  const actions = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current || work.busy) return;
    refocus.current = false;
    actions.current?.querySelector("button")?.focus();
  }, [device.kind, work.busy]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const support = pushSupport();
      if (support !== "supported") return live && setDevice({ kind: support });
      if (notificationPermission() === "denied") return live && setDevice({ kind: "denied" });
      try {
        const sub = await currentSubscription(vapidPublicKey);
        if (live) setDevice(sub ? { kind: "on" } : { kind: "off" });
      } catch {
        if (live) setDevice({ kind: "off" });
      }
    })();
    return () => {
      live = false;
    };
  }, [vapidPublicKey]);

  /** The backend's id for this device's subscription: known after turning on, else asked for (the same endpoint answers the same id). */
  async function resolveId(): Promise<string> {
    if (device.kind === "on" && device.id) return device.id;
    const sub = await currentSubscription();
    if (!sub) throw new Error("no push subscription on this device");
    const { id } = await writes.subscribeDevice(subscriptionBody(sub));
    setDevice({ kind: "on", id });
    return id;
  }

  async function turnOn() {
    setNote(null);
    refocus.current = true;
    await work.run(async () => {
      let result;
      try {
        result = await enableDevice(vapidPublicKey);
      } catch {
        setNote(SUBSCRIBE_FAILED_TEXT);
        return;
      }
      if (result.status === "denied") return setDevice({ kind: "denied" });
      if (result.status === "dismissed") return setNote(DISMISSED_TEXT);
      try {
        const { id } = await writes.subscribeDevice(subscriptionBody(result.subscription));
        setDevice({ kind: "on", id });
        setNote("Push is on for this device.");
      } catch (e) {
        // The backend refused it: don't leave a browser subscription it doesn't know about.
        await result.subscription.unsubscribe().catch(() => false);
        throw e;
      }
    });
  }

  async function sendTest() {
    setNote(null);
    await work.run(async () => {
      const answer = await writes.test.mutateAsync(await resolveId());
      setNote(pushTestText(answer));
    });
  }

  async function turnOff() {
    setNote(null);
    refocus.current = true;
    await work.run(async () => {
      try {
        await writes.unsubscribe.mutateAsync(await resolveId());
      } catch (e) {
        // Already gone on the backend is the result we wanted.
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
      const sub = await currentSubscription();
      await sub?.unsubscribe();
      setDevice({ kind: "off" });
      setNote("Push is off for this device.");
    });
  }

  return (
    <div className="grid gap-4">
      <Loadable pending={device.kind === "checking"} skeleton={<PushSkeleton label="Checking this device…" />} className="grid gap-3">
        <DeviceState device={device} />
        <div ref={actions} className="grid gap-3">
        {device.kind === "off" && (
          <div>
            <button type="button" disabled={work.busy} onClick={() => void turnOn()}>
              {work.busy ? "Turning on…" : "Turn on push on this device"}
            </button>
          </div>
        )}
        {device.kind === "on" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={work.busy} onClick={() => void sendTest()}>
              Send test notification
            </button>
            <button type="button" disabled={work.busy} onClick={() => void turnOff()}>
              Turn off push on this device
            </button>
          </div>
        )}
        </div>
        <p role="status" className="mb-0 text-sm">
          {note}
        </p>
        {work.failure !== null && <ErrorNotice error={work.failure} />}
      </Loadable>
      <OptIn writes={writes} serverId={server.id} serverName={server.displayName} />
    </div>
  );
}

function DeviceState({ device }: { device: Device }) {
  const line = (children: ReactNode) => <p className="mb-0">{children}</p>;
  switch (device.kind) {
    case "ios":
      return line(IOS_TEXT);
    case "unsupported":
      return line(UNSUPPORTED_TEXT);
    case "denied":
      return line(DENIED_TEXT);
    case "on":
      return line(
        <>
          This device is <span className="text-ok">subscribed</span>.
        </>,
      );
    case "off":
      return line("This device is not subscribed. Turning push on asks your browser for permission.");
    default:
      return null;
  }
}

/** The member's own opt-in for this server. Any role may set it: it is their notification, no server setting. */
function OptIn({ writes, serverId, serverName }: { writes: ReturnType<typeof usePushWrites>; serverId: string; serverName: string }) {
  const optIn = useQuery(queries.pushOptIn(serverId));
  const inputId = useId();
  return (
    <Loadable pending={optIn.isPending} skeleton={<PushSkeleton label="Loading your push choice…" />} className="grid gap-2">
      {!optIn.data ? (
        <ErrorNotice
          error={optIn.error}
          action={
            <button type="button" onClick={() => void optIn.refetch()}>
              Retry
            </button>
          }
        />
      ) : (
        <>
          <label htmlFor={inputId} className="flex items-center gap-2 text-sm">
            <input
              id={inputId}
              type="checkbox"
              checked={optIn.data.optedIn}
              disabled={writes.setOptIn.isPending}
              onChange={(e) => writes.setOptIn.mutate(e.target.checked)}
            />
            Notify me about {serverName} on my devices
          </label>
          <p className="mb-0 text-sm text-muted">Your own choice for this server. Owners, admins and viewers can each set it.</p>
          {writes.setOptIn.error && <ErrorNotice error={writes.setOptIn.error} />}
        </>
      )}
    </Loadable>
  );
}
