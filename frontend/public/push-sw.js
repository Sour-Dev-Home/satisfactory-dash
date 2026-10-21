/*
 * Web push service worker (ADR-0044, #348). Served as-is from /push-sw.js, no build step and no dependency.
 *
 * It does two things and nothing else: show a notification when a push arrives, and focus or open the app when the
 * notification is clicked. It has no fetch handler and no cache, so it can never serve or break the SPA, and it is
 * only registered after the user turns push on (src/push/). The payload is the backend's (348-2), plain text only:
 * { v, title, body, serverId, kind, transition, severity, at }. Text becomes notification text, never markup.
 *
 * The event logic is plain functions on `self.pushSw` so a test can load this file in a sandbox and call them.
 */
"use strict";

var MAX_TITLE = 120;
var MAX_BODY = 400;
var APP_PATH = "/app";
var ICON = "/icon-192.png";
var FALLBACK_TITLE = "Satis Manager";
var FALLBACK_BODY = "Something needs a look on one of your servers.";

function clip(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** The payload object from a push event's data, or null for no data or anything that is not a JSON object. */
function parsePayload(data) {
  if (!data) return null;
  try {
    var parsed = data.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The title and options for showNotification. A bad or empty payload still shows a generic notice (browsers require one). */
function buildNotification(payload) {
  var p = payload || {};
  var serverId = typeof p.serverId === "string" ? p.serverId.slice(0, 64) : "";
  var kind = typeof p.kind === "string" ? p.kind.slice(0, 64) : "";
  return {
    title: clip(p.title, MAX_TITLE) || FALLBACK_TITLE,
    options: {
      body: clip(p.body, MAX_BODY) || FALLBACK_BODY,
      icon: ICON,
      // One notification per server and alert kind: a renotify replaces the earlier one and alerts again.
      tag: "alert:" + serverId + ":" + kind,
      renotify: true,
      data: { serverId: serverId },
    },
  };
}

/** The window to focus: any open one inside the app, else the first open one. Null means open a new window. */
function pickClient(clients) {
  var list = Array.prototype.slice.call(clients || []);
  for (var i = 0; i < list.length; i++) {
    if (typeof list[i].url === "string" && new URL(list[i].url).pathname.indexOf(APP_PATH) === 0) return list[i];
  }
  return list.length > 0 ? list[0] : null;
}

self.pushSw = { parsePayload: parsePayload, buildNotification: buildNotification, pickClient: pickClient };

self.addEventListener("push", function (event) {
  var n = buildNotification(parsePayload(event.data));
  event.waitUntil(self.registration.showNotification(n.title, n.options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
      var target = pickClient(clients);
      if (target && typeof target.focus === "function") return target.focus();
      return self.clients.openWindow(APP_PATH);
    }),
  );
});
