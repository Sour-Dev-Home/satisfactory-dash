import type { PushSubscribeRequest } from "@satisfactory-dash/shared";

/** The service worker (public/push-sw.js): stable path, root scope, registered only after the user turns push on. */
export const PUSH_SW_URL = "/push-sw.js";

export type PushSupport = "supported" | "ios" | "unsupported";

/** iPhone, iPad, iPod, and an iPad that reports as a Mac (it has a touch screen; a Mac doesn't). */
function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * Whether this browser can do web push. iOS is its own answer: Safari there delivers push only to a Home Screen
 * web app and the push service is not yet on the backend's allowlist (ADR-0044 decisions 3 and 6), so it is "not
 * supported yet" even when the APIs exist.
 */
export function pushSupport(): PushSupport {
  if (isIos()) return "ios";
  const apis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return apis ? "supported" : "unsupported";
}

export function notificationPermission(): NotificationPermission {
  return Notification.permission;
}

/** Whether a subscription was made with this key. A browser that doesn't expose its key gets the benefit of the doubt. */
function madeWithKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const own = subscription.options?.applicationServerKey;
  if (!own) return true;
  const bytes = new Uint8Array(own);
  return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
}

/**
 * This device's push subscription, or null. Never registers the worker: no registration means no subscription.
 * With `vapidPublicKey`, a subscription made with another key (the backend's key changed) counts as none.
 */
export async function currentSubscription(vapidPublicKey?: string): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (subscription && vapidPublicKey !== undefined && !madeWithKey(subscription, keyBytes(vapidPublicKey))) return null;
  return subscription;
}

/** A base64url VAPID public key as the bytes `subscribe` wants. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** `serviceWorker.ready` never settles when the worker fails to install; Turn on gives up after this long. */
export const READY_TIMEOUT_MS = 10_000;

export class PushTimeoutError extends Error {
  constructor() {
    super("the service worker did not become ready in time");
    this.name = "PushTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PushTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export type EnableResult = { status: "subscribed"; subscription: PushSubscription } | { status: "denied" } | { status: "dismissed" };

/**
 * Turns push on for this device. Call it from a click only: the permission prompt must come from a user gesture.
 * Asks permission first, then registers the worker and subscribes with the backend's VAPID key.
 */
export async function enableDevice(vapidPublicKey: string): Promise<EnableResult> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return { status: "denied" };
  if (permission !== "granted") return { status: "dismissed" };
  await navigator.serviceWorker.register(PUSH_SW_URL);
  const registration = await withTimeout(navigator.serviceWorker.ready, READY_TIMEOUT_MS);
  const key = keyBytes(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();
  // One made with another VAPID key can never receive our pushes (and subscribe() would throw): replace it.
  if (subscription && !madeWithKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return { status: "subscribed", subscription };
}

/** The request body for the backend: exactly the browser's own endpoint and keys, nothing else. */
export function subscriptionBody(subscription: PushSubscription): PushSubscribeRequest {
  const json = subscription.toJSON();
  return { endpoint: json.endpoint ?? subscription.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } };
}
