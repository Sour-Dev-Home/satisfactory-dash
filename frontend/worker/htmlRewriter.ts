// The slice of Cloudflare's HTMLRewriter the Worker uses (cloudflare-workers-assets-worker-2026-11-01.md, E6), typed
// here instead of adding @cloudflare/workers-types for three members. The tests pass their own implementation.

export interface RewriterElement {
  readonly tagName: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): RewriterElement;
  /**
   * Inserts content right before the element's end tag; `{ html: true }` inserts it as raw HTML, otherwise it is
   * escaped as text (cloudflare-workers-htmlrewriter-content-2026-11-01.md, HR-E1). Whether inserted content goes
   * through the rewriter's handlers again is not documented, so anything it needs (a nonce) is written into it by the
   * caller.
   */
  append(content: string, options?: { html: boolean }): RewriterElement;
}

export interface RewriterElementHandler {
  element(element: RewriterElement): void;
}

export interface HTMLRewriterInstance {
  on(selector: string, handler: RewriterElementHandler): HTMLRewriterInstance;
  transform(response: Response): Response;
}

export type HTMLRewriterConstructor = new () => HTMLRewriterInstance;
