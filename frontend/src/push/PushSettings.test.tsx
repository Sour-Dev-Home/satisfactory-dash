import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import {
  errorPushDisabled,
  errorRateLimited,
  errorPushEndpointInvalid,
  pushConfigDisabled,
  pushConfigEnabled,
  pushOptInOff,
  pushOptInOn,
  pushSubscribeResponse,
  pushUnsubscribeResponse,
  serversRoleViewer,
  serversSingle,
} from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { READY_TIMEOUT_MS } from "./pushBrowser";
import { PushSettings } from "./PushSettings";

// Settings → Alerts → push (ADR-0044, #348). The browser's side (Notification, PushManager, the service worker
// registration) is faked; the backend's is MSW. Permission must only ever be asked by the Turn on click.

const ENDPOINT = "https://push.example.test/send/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const KEYS = { p256dh: "B".repeat(87), auth: "C".repeat(22) };

interface Options {
  permission?: NotificationPermission;
  /** What the permission prompt answers when asked. */
  prompt?: NotificationPermission;
  /** Already subscribed in this browser. */
  subscribed?: boolean;
  noPushManager?: boolean;
  userAgent?: string;
}

function fakeBrowser({ permission = "default", prompt = "granted", subscribed = false, noPushManager = false, userAgent }: Options = {}) {
  let current: unknown = null;
  const subscription = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: KEYS }),
    unsubscribe: vi.fn(() => {
      current = null;
      return Promise.resolve(true);
    }),
  };
  if (subscribed) current = subscription;
  let registered = subscribed;
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(current)),
    subscribe: vi.fn(() => {
      current = subscription;
      return Promise.resolve(subscription);
    }),
  };
  const registration = { pushManager };
  const serviceWorker = {
    getRegistration: vi.fn(() => Promise.resolve(registered ? registration : undefined)),
    register: vi.fn(() => {
      registered = true;
      return Promise.resolve(registration);
    }),
    get ready() {
      return Promise.resolve(registration);
    },
  };
  const requestPermission = vi.fn(() => Promise.resolve(prompt));
  vi.stubGlobal("Notification", { permission, requestPermission });
  if (noPushManager) vi.stubGlobal("PushManager", undefined);
  else vi.stubGlobal("PushManager", class {});
  if (noPushManager) Reflect.deleteProperty(window, "PushManager");
  Object.defineProperty(navigator, "serviceWorker", { value: serviceWorker, configurable: true });
  if (userAgent) vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  return { subscription, pushManager, serviceWorker, requestPermission };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

const enabled = () => server.use(http.get(endpoints.push.config.route, () => HttpResponse.json(pushConfigEnabled)));
const summary = serversSingle.servers[0];

function renderPush(serverSummary = summary) {
  return renderWithClient(
    <ServerContext value={serverSummary}>
      <PushSettings />
    </ServerContext>,
  );
}

describe("when push is off on the backend", () => {
  it("explains it, with no buttons and no opt-in", async () => {
    fakeBrowser();
    server.use(http.get(endpoints.push.config.route, () => HttpResponse.json(pushConfigDisabled)));
    renderPush();
    expect(await screen.findByText(/turned off on this backend/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Push notifications on this device" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the read's failure with Retry", async () => {
    fakeBrowser();
    server.use(
      http.get(endpoints.push.config.route, () =>
        HttpResponse.json({ error: { code: "internal", message: "Something went wrong", requestId: "r" } }, { status: 500 }),
      ),
    );
    renderPush();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("what this browser can do", () => {
  it("says so on iPhone and iPad (not supported yet), even where the APIs exist", async () => {
    fakeBrowser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" });
    enabled();
    renderPush();
    expect(await screen.findByText(/aren't supported on iPhone and iPad yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Turn on push/ })).toBeNull();
  });

  it("says so in a browser without push", async () => {
    fakeBrowser({ noPushManager: true });
    enabled();
    renderPush();
    expect(await screen.findByText(/can't receive push notifications/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Turn on push/ })).toBeNull();
  });

  it("says so when notifications are blocked, without asking again", async () => {
    const browser = fakeBrowser({ permission: "denied" });
    enabled();
    renderPush();
    expect(await screen.findByText(/Notifications are blocked for this site/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Turn on push/ })).toBeNull();
    expect(browser.requestPermission).not.toHaveBeenCalled();
  });
});

describe("turning push on", () => {
  it("asks permission only on the click, then subscribes with the VAPID key and posts the subscription", async () => {
    const browser = fakeBrowser();
    enabled();
    const posted = vi.fn();
    server.use(
      http.post(endpoints.push.subscribe.route, async ({ request }) => {
        posted(await request.json());
        return HttpResponse.json(pushSubscribeResponse, { status: 201 });
      }),
    );
    const { client } = renderPush();
    const button = await screen.findByRole("button", { name: "Turn on push on this device" });
    expect(screen.getByText(/This device is not subscribed/)).toBeInTheDocument();
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(browser.serviceWorker.register).not.toHaveBeenCalled();

    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText(/This device is/)).toHaveTextContent("This device is subscribed."), { timeout: 5000 });
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.serviceWorker.register).toHaveBeenCalledWith("/push-sw.js");
    const options = (browser.pushManager.subscribe.mock.calls as unknown[][])[0][0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(options.applicationServerKey).toHaveLength(65);
    expect(posted).toHaveBeenCalledWith({ endpoint: ENDPOINT, keys: KEYS });
    expect(screen.getByRole("status")).toHaveTextContent("Push is on for this device.");
    expect(screen.getByRole("button", { name: "Send test notification" })).toBeInTheDocument();
    // The endpoint and keys are secrets: no mutation or query keeps them.
    const kept = JSON.stringify([
      client.getMutationCache().getAll().map((m) => ({ v: m.state.variables, d: m.state.data })),
      client.getQueryCache().getAll().map((q) => q.state.data),
    ]);
    expect(kept).not.toContain("push.example.test");
    expect(kept).not.toContain(KEYS.auth);
  });

  it("handles a refused prompt as blocked", async () => {
    fakeBrowser({ prompt: "denied" });
    enabled();
    renderPush();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on push on this device" }));
    expect(await screen.findByText(/Notifications are blocked for this site/)).toBeInTheDocument();
  });

  it("handles a dismissed prompt: push stays off and the button stays", async () => {
    const browser = fakeBrowser({ prompt: "default" });
    enabled();
    renderPush();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on push on this device" }));
    expect(await screen.findByText(/Permission wasn't given/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Permission wasn't given");
    expect(browser.serviceWorker.register).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Turn on push on this device" })).toBeEnabled();
  });

  it("says when the browser can't register, and keeps the button", async () => {
    const browser = fakeBrowser();
    browser.pushManager.subscribe.mockRejectedValueOnce(new Error("push service error"));
    enabled();
    renderPush();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on push on this device" }));
    expect(await screen.findByText(/couldn't register for push/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on push on this device" })).toBeEnabled();
  });

  it("undoes the browser's subscription when the backend refuses it", async () => {
    const browser = fakeBrowser();
    enabled();
    server.use(http.post(endpoints.push.subscribe.route, () => HttpResponse.json(errorPushEndpointInvalid, { status: 400 })));
    renderPush();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on push on this device" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not accepted/);
    expect(browser.subscription.unsubscribe).toHaveBeenCalled();
    expect(screen.getByText(/This device is not subscribed/)).toBeInTheDocument();
  });
});

describe("a subscribed device", () => {
  it("shows as subscribed on load, without asking for anything", async () => {
    const browser = fakeBrowser({ permission: "granted", subscribed: true });
    enabled();
    renderPush();
    await waitFor(() => expect(screen.getByText(/This device is/)).toHaveTextContent("This device is subscribed."), { timeout: 5000 });
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Turn on push/ })).toBeNull();
  });

  it("sends a test to its own subscription and reads the result out", async () => {
    fakeBrowser({ permission: "granted", subscribed: true });
    enabled();
    const tested = vi.fn();
    server.use(
      http.post(endpoints.push.test.route, ({ params }) => {
        tested(params.id);
        return HttpResponse.json({ ok: true });
      }),
    );
    renderPush();
    fireEvent.click(await screen.findByRole("button", { name: "Send test notification" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Sent\. A notification should arrive/));
    // The backend's id comes from re-posting the same subscription (idempotent on its side).
    expect(tested).toHaveBeenCalledWith(pushSubscribeResponse.id);
  });

  it.each([
    [{ ok: false, code: "unavailable" }, /isn't available on the server yet/],
    [{ ok: false, code: "gone" }, /subscription has expired/],
    [{ ok: false, code: "something_new" }, /didn't go out \(something new\)/],
  ])("explains a failed test (%j) in plain words", async (answer, text) => {
    fakeBrowser({ permission: "granted", subscribed: true });
    enabled();
    server.use(http.post(endpoints.push.test.route, () => HttpResponse.json(answer)));
    renderPush();
    fireEvent.click(await screen.findByRole("button", { name: "Send test notification" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(text));
  });

  it("explains a rate-limited test (429) as an error", async () => {
    fakeBrowser({ permission: "granted", subscribed: true });
    enabled();
    server.use(http.post(endpoints.push.test.route, () => HttpResponse.json(errorRateLimited, { status: 429 })));
    renderPush();
    fireEvent.click(await screen.findByRole("button", { name: "Send test notification" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("turns off: deletes it on the backend, then unsubscribes in the browser", async () => {
    const browser = fakeBrowser({ permission: "granted", subscribed: true });
    enabled();
    const deleted = vi.fn();
    server.use(
      http.delete(endpoints.push.unsubscribe.route, ({ params }) => {
        deleted(params.id);
        return HttpResponse.json(pushUnsubscribeResponse);
      }),
    );
    renderPush();
    fireEvent.click(await screen.findByRole("button", { name: "Turn off push on this device" }));
    expect(await screen.findByText(/This device is not subscribed/)).toBeInTheDocument();
    expect(deleted).toHaveBeenCalledWith(pushSubscribeResponse.id);
    expect(browser.subscription.unsubscribe).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Push is off for this device.");
    expect(screen.getByRole("button", { name: "Turn on push on this device" })).toBeInTheDocument();
  });

  it("keeps the subscription when the backend can't delete it, and says why", async () => {
    const browser = fakeBrowser({ permission: "granted", subscribed: true });
    enabled();
    server.use(http.delete(endpoints.push.unsubscribe.route, () => HttpResponse.json(errorPushDisabled, { status: 409 })));
    renderPush();
    fireEvent.click(await screen.findByRole("button", { name: "Turn off push on this device" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not enabled/);
    expect(browser.subscription.unsubscribe).not.toHaveBeenCalled();
    expect(screen.getByText(/This device is/)).toHaveTextContent("subscribed");
  });
});

describe("the per-server opt-in", () => {
  it("shows the member's choice, named for the server, and saves a change", async () => {
    fakeBrowser();
    enabled();
    server.use(http.get(endpoints.push.optIn.get.route, () => HttpResponse.json(pushOptInOff)));
    const put = vi.fn();
    server.use(
      http.put(endpoints.push.optIn.put.route, async ({ request }) => {
        put(await request.json());
        return HttpResponse.json(pushOptInOn);
      }),
    );
    renderPush();
    const box = await screen.findByRole("checkbox", { name: `Notify me about ${summary.displayName} on my devices` });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(put).toHaveBeenCalledWith({ optedIn: true });
  });

  it("is there for a viewer too", async () => {
    fakeBrowser();
    enabled();
    server.use(http.get(endpoints.push.optIn.get.route, () => HttpResponse.json(pushOptInOn)));
    renderPush(serversRoleViewer.servers[0]);
    const box = await screen.findByRole("checkbox", { name: /Notify me about/ });
    expect(box).toBeChecked();
    expect(box).toBeEnabled();
  });

  it("shows a failed save beside the box", async () => {
    fakeBrowser();
    enabled();
    server.use(http.put(endpoints.push.optIn.put.route, () => HttpResponse.json(errorPushDisabled, { status: 409 })));
    renderPush();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Notify me about/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not enabled/);
  });
});

describe("hunt: a subscription made with another VAPID key", () => {
  const otherKey = () => new Uint8Array(65).fill(7).buffer;

  it("is replaced on Turn on instead of being reused", async () => {
    const browser = fakeBrowser({ subscribed: true });
    Object.assign(browser.subscription, { options: { applicationServerKey: otherKey() } });
    enabled();
    server.use(http.post(endpoints.push.subscribe.route, () => HttpResponse.json(pushSubscribeResponse, { status: 201 })));
    renderPush();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on push on this device" }));
    await waitFor(() => expect(screen.getByText(/This device is/)).toHaveTextContent("subscribed"), { timeout: 5000 });
    expect(browser.subscription.unsubscribe).toHaveBeenCalled();
    expect(browser.pushManager.subscribe).toHaveBeenCalledTimes(1);
  });

  it("shows as off on load (it cannot receive our pushes)", async () => {
    const browser = fakeBrowser({ subscribed: true });
    Object.assign(browser.subscription, { options: { applicationServerKey: otherKey() } });
    enabled();
    renderPush();
    expect(await screen.findByRole("button", { name: "Turn on push on this device" })).toBeInTheDocument();
  });
});

describe("hunt: focus", () => {
  it("lands on the new first button after Turn on and after Turn off", async () => {
    fakeBrowser();
    enabled();
    server.use(
      http.post(endpoints.push.subscribe.route, () => HttpResponse.json(pushSubscribeResponse, { status: 201 })),
      http.delete(endpoints.push.unsubscribe.route, () => HttpResponse.json(pushUnsubscribeResponse)),
    );
    renderPush();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on push on this device" }));
    // Query again on each try: the assertion is about whichever button is on screen now, not a stale node.
    await waitFor(() => expect(screen.getByRole("button", { name: "Send test notification" })).toHaveFocus(), { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Turn off push on this device" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Turn on push on this device" })).toHaveFocus(), { timeout: 5000 });
    // Two waits of up to 5 s plus the first find: the test's own budget must exceed them (Vitest's default is 5 s in all).
  }, 20_000);
});

describe("permission changes while the page is open", () => {
  it("stops saying subscribed when the tab becomes visible again and notifications are blocked", async () => {
    fakeBrowser({ permission: "granted", subscribed: true });
    enabled();
    renderPush();
    await waitFor(() => expect(screen.getByText(/This device is/)).toHaveTextContent("subscribed"), { timeout: 5000 });
    (Notification as unknown as { permission: string }).permission = "denied";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(await screen.findByText(/Notifications are blocked for this site/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send test notification" })).toBeNull();
  });

  it("follows the Permissions API's change event where it exists", async () => {
    fakeBrowser({ permission: "granted", subscribed: true });
    const status = new EventTarget();
    const query = vi.fn(() => Promise.resolve(status));
    Object.defineProperty(navigator, "permissions", { value: { query }, configurable: true });
    try {
      enabled();
      renderPush();
      await waitFor(() => expect(screen.getByText(/This device is/)).toHaveTextContent("subscribed"), { timeout: 5000 });
      await waitFor(() => expect(query).toHaveBeenCalledWith({ name: "notifications" }));
      await Promise.resolve();
      (Notification as unknown as { permission: string }).permission = "denied";
      status.dispatchEvent(new Event("change"));
      expect(await screen.findByText(/Notifications are blocked for this site/)).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, "permissions");
    }
  });
});

describe("a service worker that never becomes ready", () => {
  it("gives up after a while with a plain message, and the button works again", async () => {
    const browser = fakeBrowser();
    Object.defineProperty(browser.serviceWorker, "ready", { get: () => new Promise(() => undefined) });
    enabled();
    renderPush();
    const button = await screen.findByRole("button", { name: "Turn on push on this device" });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS + 100);
    } finally {
      vi.useRealTimers();
    }
    expect(await screen.findByText(/took too long to start push/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on push on this device" })).toBeEnabled();
  });
});

describe("when this device can't use push", () => {
  it("disables the opt-in and says why", async () => {
    fakeBrowser({ permission: "denied" });
    enabled();
    renderPush();
    const box = await screen.findByRole("checkbox", { name: /Notify me about/ });
    await waitFor(() => expect(box).toBeDisabled());
    expect(screen.getByText(/this choice can't be changed here/)).toBeInTheDocument();
    expect(box).toHaveAccessibleDescription(/can't be changed here/);
  });

  it("explains the choice's scope otherwise", async () => {
    fakeBrowser();
    enabled();
    renderPush();
    expect(await screen.findByText("Your own choice for this server. It applies to every device where push is on.")).toBeInTheDocument();
  });
});
