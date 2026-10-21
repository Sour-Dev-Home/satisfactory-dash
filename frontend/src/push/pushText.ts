import { ownValue } from "@satisfactory-dash/shared";

/** The test-send failure codes the backend names (shared/alerts.ts SendTestResponseSchema), in plain words. */
const TEST_FAILED: Record<string, string> = {
  unavailable: "Sending push isn't available on the server yet.",
  rate_limited: "Too many tests. Wait a minute and try again.",
  rejected: "The browser's push service refused the test. Turn push off and on again on this device.",
  gone: "This device's subscription has expired. Turn push off and on again.",
  subscription_gone: "This device's subscription has expired. Turn push off and on again.",
  secret_unreadable: "The server couldn't read this device's subscription. Turn push off and on again.",
  push_disabled: "Push notifications are turned off on the server.",
};

export function pushTestText(answer: { ok: true } | { ok: false; code: string }): string {
  if (answer.ok) return "Sent. A notification should arrive on this device in a moment.";
  const known = ownValue(TEST_FAILED, answer.code);
  if (known) return known;
  const code = answer.code.replace(/_/g, " ").trim().toLowerCase();
  return code ? `The test didn't go out (${code}).` : "The test didn't go out.";
}

export const IOS_TEXT =
  "Push notifications aren't supported on iPhone and iPad yet. Use a desktop browser or an Android phone, or watch Discord.";
export const UNSUPPORTED_TEXT = "This browser can't receive push notifications. Try a current Chrome, Edge or Firefox.";
export const DENIED_TEXT =
  "Notifications are blocked for this site. Allow them in your browser's site settings, then reload this page.";
export const DISMISSED_TEXT = "Permission wasn't given, so push is still off. You can try again.";
export const DISABLED_TEXT = "Push notifications are turned off on this backend, so there is nothing to set up yet.";
export const SUBSCRIBE_FAILED_TEXT = "Your browser couldn't register for push. Try again in a moment.";
