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
