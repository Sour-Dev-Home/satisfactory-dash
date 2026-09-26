import { describe, expect, it } from "vitest";
import { parseDiscordWebhookUrl } from "./discordWebhook.js";

// Invented id and token (shape only): 19-digit snowflake, 68-character URL-safe token.
const ID = "1234567890123456789";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const good = `https://discord.com/api/webhooks/${ID}/${TOKEN}`;

describe("parseDiscordWebhookUrl: the only URL shape the backend will send an alert to", () => {
  it("accepts Discord's webhook URL on discord.com and discordapp.com, with or without an API version", () => {
    expect(parseDiscordWebhookUrl(good)).toEqual({ ok: true, url: good, last4: TOKEN.slice(-4) });
    expect(parseDiscordWebhookUrl(`https://discordapp.com/api/webhooks/${ID}/${TOKEN}`)).toMatchObject({ ok: true });
    expect(parseDiscordWebhookUrl(`https://discord.com/api/v10/webhooks/${ID}/${TOKEN}`)).toMatchObject({ ok: true });
  });

  it("canonicalises: trims, lowercases the host, drops the default port", () => {
    expect(parseDiscordWebhookUrl(`  HTTPS://DISCORD.COM:443/api/webhooks/${ID}/${TOKEN}  `)).toEqual({ ok: true, url: good, last4: TOKEN.slice(-4) });
  });

  it.each([
    ["http", `http://discord.com/api/webhooks/${ID}/${TOKEN}`, "not_https"],
    ["ftp", `ftp://discord.com/api/webhooks/${ID}/${TOKEN}`, "not_https"],
    ["a scheme-relative URL", `//discord.com/api/webhooks/${ID}/${TOKEN}`, "not_a_url"],
    ["no scheme", `discord.com/api/webhooks/${ID}/${TOKEN}`, "not_a_url"],
    ["another host", `https://example.com/api/webhooks/${ID}/${TOKEN}`, "host_not_allowed"],
    ["a subdomain", `https://canary.discord.com/api/webhooks/${ID}/${TOKEN}`, "host_not_allowed"],
    ["a look-alike suffix", `https://discord.com.attacker.example/api/webhooks/${ID}/${TOKEN}`, "host_not_allowed"],
    ["a look-alike prefix", `https://notdiscord.com/api/webhooks/${ID}/${TOKEN}`, "host_not_allowed"],
    ["a hyphen look-alike", `https://discord-com.example/api/webhooks/${ID}/${TOKEN}`, "host_not_allowed"],
    ["userinfo that hides the host", `https://discord.com@attacker.example/api/webhooks/${ID}/${TOKEN}`, "credentials_in_url"],
    ["userinfo with a colon", `https://user:pass@discord.com/api/webhooks/${ID}/${TOKEN}`, "credentials_in_url"],
    ["a custom port", `https://discord.com:8443/api/webhooks/${ID}/${TOKEN}`, "port_not_allowed"],
    ["a query string", `https://discord.com/api/webhooks/${ID}/${TOKEN}?wait=true`, "query_or_fragment"],
    ["a fragment", `https://discord.com/api/webhooks/${ID}/${TOKEN}#x`, "query_or_fragment"],
    ["a bare question mark", `https://discord.com/api/webhooks/${ID}/${TOKEN}?`, "query_or_fragment"],
    ["a bare hash", `https://discord.com/api/webhooks/${ID}/${TOKEN}#`, "query_or_fragment"],
    ["a different path", `https://discord.com/api/users/@me`, "path_not_a_webhook"],
    ["the webhook path without a token", `https://discord.com/api/webhooks/${ID}`, "path_not_a_webhook"],
    ["a token that is too short", `https://discord.com/api/webhooks/${ID}/abc`, "path_not_a_webhook"],
    ["a non-numeric id", `https://discord.com/api/webhooks/abc/${TOKEN}`, "path_not_a_webhook"],
    ["an extra path segment", `https://discord.com/api/webhooks/${ID}/${TOKEN}/github`, "path_not_a_webhook"],
    ["path traversal", `https://discord.com/api/webhooks/${ID}/../../${TOKEN}`, "path_not_a_webhook"],
    ["an encoded slash", `https://discord.com/api/webhooks/${ID}%2f${TOKEN}`, "not_a_url"],
    ["an encoded dot", `https://discord.com/api/webhooks/${ID}/%2e%2e/${TOKEN}`, "not_a_url"],
    ["a backslash", `https://discord.com\\@attacker.example/api/webhooks/${ID}/${TOKEN}`, "not_a_url"],
    ["a space inside", `https://discord.com/api/webhooks/${ID}/${TOKEN} x`, "not_a_url"],
    ["a newline inside", `https://discord.com/api/webhooks/${ID}/${TOKEN}\nHost: x`, "not_a_url"],
    ["a tab inside", `https://discord.com/api/web\thooks/${ID}/${TOKEN}`, "not_a_url"],
    ["an IPv4 host", `https://162.159.128.233/api/webhooks/${ID}/${TOKEN}`, "host_not_allowed"],
    ["an IPv6 host", `https://[::1]/api/webhooks/${ID}/${TOKEN}`, "host_not_allowed"],
    ["localhost", `https://localhost/api/webhooks/${ID}/${TOKEN}`, "host_not_allowed"],
    ["an idn look-alike host", `https://dıscord.com/api/webhooks/${ID}/${TOKEN}`, "host_not_allowed"],
    ["a trailing dot host", `https://discord.com./api/webhooks/${ID}/${TOKEN}`, "host_not_allowed"],
  ])("refuses %s", (_name, input, code) => {
    expect(parseDiscordWebhookUrl(input)).toEqual({ ok: false, code });
  });

  // Added by the fresh-eyes pass (mutation testing): each of these survived the removal of one check.
  it.each([
    ["a password without a user name", `https://:secret@discord.com/api/webhooks/${ID}/${TOKEN}`, "credentials_in_url"],
    ["the ptb subdomain", `https://ptb.discord.com/api/webhooks/${ID}/${TOKEN}`, "host_not_allowed"],
    ["a too short id", `https://discord.com/api/webhooks/1/${TOKEN}`, "path_not_a_webhook"],
    ["a 26 digit id", `https://discord.com/api/webhooks/${"1".repeat(26)}/${TOKEN}`, "path_not_a_webhook"],
    ["a 121 character token", `https://discord.com/api/webhooks/${ID}/${"a".repeat(121)}`, "path_not_a_webhook"],
    ["an extra path segment before webhooks", `https://discord.com/api/foo/webhooks/${ID}/${TOKEN}`, "path_not_a_webhook"],
    ["a version without digits", `https://discord.com/api/v/webhooks/${ID}/${TOKEN}`, "path_not_a_webhook"],
    ["a three digit version", `https://discord.com/api/v100/webhooks/${ID}/${TOKEN}`, "path_not_a_webhook"],
    ["a path not starting at /api", `https://discord.com/x/api/webhooks/${ID}/${TOKEN}`, "path_not_a_webhook"],
    ["a DEL character", `https://discord.com/api/webhooks/${ID}/${TOKEN}\u007f`, "not_a_url"],
    ["a C1 control (NEL)", `https://discord.com/api/webhooks/${ID}/\u0085${TOKEN}`, "not_a_url"],
    ["a no-break space", `https://discord.com/api/webhooks/${ID}/${TOKEN} x`, "not_a_url"],
    ["an em space", `https://discord.com/api/webhooks/${ID}/ ${TOKEN}`, "not_a_url"],
  ])("refuses %s", (_name, input, code) => {
    expect(parseDiscordWebhookUrl(input)).toEqual({ ok: false, code });
  });

  it("an empty or blank value is `not_a_url`, not `too_long` (the admin script prints the code)", () => {
    expect(parseDiscordWebhookUrl("")).toEqual({ ok: false, code: "not_a_url" });
    expect(parseDiscordWebhookUrl("   \n")).toEqual({ ok: false, code: "not_a_url" });
    expect(parseDiscordWebhookUrl("a".repeat(301))).toEqual({ ok: false, code: "too_long" });
  });

  it("accepts a 20 and a 120 character token and a 15 and a 25 digit id (the documented bounds)", () => {
    for (const path of [`${"1".repeat(15)}/${"a".repeat(20)}`, `${"1".repeat(25)}/${"a".repeat(120)}`]) {
      expect(parseDiscordWebhookUrl(`https://discord.com/api/webhooks/${path}`)).toMatchObject({ ok: true });
    }
  });

  it.each([undefined, null, 42, {}, [], true, ""])("refuses a non-string or empty value (%s)", (input) => {
    expect(parseDiscordWebhookUrl(input).ok).toBe(false);
  });

  it("refuses an over-long value without parsing it", () => {
    expect(parseDiscordWebhookUrl(`https://discord.com/api/webhooks/${ID}/${"a".repeat(400)}`)).toEqual({ ok: false, code: "too_long" });
  });

  it("never echoes the input, and reports only the last 4 characters of an accepted one", () => {
    const rejected = parseDiscordWebhookUrl(`https://evil.example/api/webhooks/${ID}/${TOKEN}`);
    expect(JSON.stringify(rejected)).not.toContain(TOKEN);
    const accepted = parseDiscordWebhookUrl(good);
    expect(accepted.ok && accepted.last4).toBe(TOKEN.slice(-4));
    expect(JSON.stringify({ ...accepted, url: undefined })).not.toContain(TOKEN.slice(0, -4));
  });
});
