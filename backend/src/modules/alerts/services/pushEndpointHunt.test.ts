import { describe, expect, it } from "vitest";
import { DEFAULT_PUSH_ENDPOINT_HOSTS } from "../pushConfig.js";
import { parsePushEndpoint } from "./pushEndpoint.js";

// Test hunt (#348-1): the default allowlist against hostile and odd endpoint shapes.
const reason = (raw: string) => {
  const r = parsePushEndpoint(raw, DEFAULT_PUSH_ENDPOINT_HOSTS);
  return r.ok ? "ok" : r.reason;
};

describe("parsePushEndpoint with the default allowlist", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://FCM.GoogleAPIs.com/fcm/send/abc",
    "https://fcm.googleapis.com:443/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "https://a.b.notify.windows.com/w/",
  ])("accepts %s", (raw) => {
    expect(reason(raw)).toBe("ok");
  });

  it.each([
    ["http://fcm.googleapis.com/x", "not_https"],
    ["https://fcm.googleapis.com.evil.com/x", "host_not_allowed"],
    ["https://evil.com/fcm.googleapis.com", "host_not_allowed"],
    ["https://evil.com?fcm.googleapis.com", "host_not_allowed"],
    ["https://fcm.googleapis.com@evil.com/x", "credentials_in_url"],
    ["https://evil.com@fcm.googleapis.com/x", "credentials_in_url"],
    ["https://@fcm.googleapis.com/x", "ok"],
    ["https://fcm.googleapis.com./x", "host_not_allowed"],
    ["https://fcm.googleapis.com:8443/x", "port_not_allowed"],
    ["https://fcm.googleapis.com:80/x", "port_not_allowed"],
    ["https://notify.windows.com/x", "host_not_allowed"],
    ["https://evilnotify.windows.com/x", "host_not_allowed"],
    ["https://evil-notify.windows.com/x", "host_not_allowed"],
    ["https://x.notify.windows.com.evil.com/x", "host_not_allowed"],
    ["https://2130706433/x", "host_not_allowed"],
    ["https://0x7f.1/x", "host_not_allowed"],
    ["https://[::ffff:127.0.0.1]/x", "host_not_allowed"],
    ["https://fcm.googleapis.com%2eevil.com/x", "host_not_allowed"],
    ["https://fcm。googleapis。com/x", "ok"], // ideographic full stop folds to a dot: the same real host
    ["https://fcm.googleapis.com。/x", "host_not_allowed"],
    ["https://fcm.göogleapis.com/x", "host_not_allowed"],
    ["https://фcm.googleapis.com/x", "host_not_allowed"],
    ["https://fcm.googleapis.com\u0000/x", "not_a_url"],
    ["HTTPS://fcm.googleapis.com/x", "ok"],
    ["javascript:https://fcm.googleapis.com/x", "not_https"],
    ["//fcm.googleapis.com/x", "not_a_url"],
    ["https:fcm.googleapis.com/x", "ok"], // WHATWG parser normalises this to https://fcm.googleapis.com/x
  ])("%j -> %s", (raw, expected) => {
    expect(reason(raw)).toBe(expected);
  });

  it("the canonical URL and hash are identical for equivalent spellings (dedupe key)", () => {
    const a = parsePushEndpoint("https://FCM.googleapis.com:443/fcm/send/abc", DEFAULT_PUSH_ENDPOINT_HOSTS);
    const b = parsePushEndpoint("https://fcm.googleapis.com/fcm/send/abc", DEFAULT_PUSH_ENDPOINT_HOSTS);
    if (!a.ok || !b.ok) throw new Error("both should parse");
    expect(a.hash.equals(b.hash)).toBe(true);
  });
});
