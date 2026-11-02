// The slice of Cloudflare's HTMLRewriter the Worker uses (cloudflare-workers-assets-worker-2026-11-01.md, E6), typed
// here instead of adding @cloudflare/workers-types for three members. The tests pass their own implementation.

export interface RewriterElement {
  readonly tagName: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): RewriterElement;
}

export interface RewriterElementHandler {
  element(element: RewriterElement): void;
}

export interface HTMLRewriterInstance {
  on(selector: string, handler: RewriterElementHandler): HTMLRewriterInstance;
  transform(response: Response): Response;
}

export type HTMLRewriterConstructor = new () => HTMLRewriterInstance;
