// Tests only (the Worker unit tests and e2e/ads-on.spec.ts): never imported by index.ts or handle.ts, so Wrangler does
// not bundle it.
import type { HTMLRewriterInstance, RewriterElement, RewriterElementHandler } from "./htmlRewriter";

/**
 * A stand-in for Cloudflare's HTMLRewriter (not available in Node): finds start tags by name and lets the handlers
 * read and set attributes and append HTML before the end tag, as the real one does for a tag-name selector
 * (cloudflare-workers-assets-worker-2026-11-01.md E6, cloudflare-workers-htmlrewriter-content-2026-11-01.md HR-E1).
 * Enough for the double-quoted attributes Vite and the static pages write; which elements get a nonce, and what is
 * inserted, is decided by the Worker, not by this. Appended content is not passed through the handlers.
 */
export class FakeRewriter implements HTMLRewriterInstance {
  private handlers: [string, RewriterElementHandler][] = [];

  on(selector: string, handler: RewriterElementHandler): HTMLRewriterInstance {
    this.handlers.push([selector, handler]);
    return this;
  }

  transform(response: Response): Response {
    const handlers = this.handlers;
    const body = response.text().then((html) => {
      const appended: { name: string; content: string; text: boolean }[] = [];
      const tagged = html.replace(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>/g, (tag, name: string, rawAttrs: string, selfClose: string) => {
        const matching = handlers.filter(([selector]) => selector === name.toLowerCase());
        if (matching.length === 0) return tag;
        const attrs: [string, string | null][] = [...rawAttrs.matchAll(/\s+([^\s=>/]+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? null]);
        const mine: number[] = [];
        const element: RewriterElement = {
          tagName: name.toLowerCase(),
          getAttribute: (attr) => {
            const found = attrs.find(([key]) => key.toLowerCase() === attr);
            return found ? (found[1] ?? "") : null;
          },
          setAttribute(attr, value) {
            const found = attrs.find(([key]) => key.toLowerCase() === attr);
            if (found) found[1] = value;
            else attrs.push([attr, value]);
            return element;
          },
          append(content, options) {
            mine.push(appended.length);
            appended.push({ name: name.toLowerCase(), content, text: !options?.html });
            return element;
          },
        };
        for (const [, handler] of matching) handler.element(element);
        const rebuilt = attrs.map(([key, value]) => (value === null ? ` ${key}` : ` ${key}="${value}"`)).join("");
        // A marker after the start tag; the content lands before the next matching end tag below.
        return `<${name}${rebuilt}${selfClose ? " /" : ""}>${mine.map((i) => `\u0000${i}\u0000`).join("")}`;
      });
      return insertAppended(tagged, appended);
    });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode(await body));
        controller.close();
      },
    });
    return new Response(stream, response);
  }
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Moves each appended item from its marker to just before the next `</name>` after it, in the order appended. */
function insertAppended(tagged: string, appended: { name: string; content: string; text: boolean }[]): string {
  let html = tagged;
  for (let i = 0; i < appended.length; i++) {
    const marker = `\u0000${i}\u0000`;
    const at = html.indexOf(marker);
    html = html.slice(0, at) + html.slice(at + marker.length);
    const { name, content, text } = appended[i];
    const end = html.toLowerCase().indexOf(`</${name}>`, at);
    if (end === -1) continue;
    html = html.slice(0, end) + (text ? escapeText(content) : content) + html.slice(end);
  }
  return html;
}
