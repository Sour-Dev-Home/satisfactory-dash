// The Worker's entry (wrangler.jsonc `main`). It exports only the handler: workerd treats every named export of the entry
// module as an entrypoint and refuses to start on any other kind (a constant took the runtime down in `wrangler dev`), so
// the logic and everything the tests import live in handle.ts.
import type { HTMLRewriterConstructor } from "./htmlRewriter";
import { handle, type Env } from "./handle";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, (globalThis as unknown as { HTMLRewriter: HTMLRewriterConstructor }).HTMLRewriter);
  },
};
