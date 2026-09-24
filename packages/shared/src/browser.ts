import { z } from "zod";

/**
 * Browser-only setup: import this FIRST in the frontend entry point
 * (`@satisfactory-dash/shared/browser`). The backend must never import it.
 *
 * Zod probes whether it may compile validators at runtime with `new Function("")` inside a
 * try/catch. Under a strict Content-Security-Policy (no `unsafe-eval`, ADR-0016) the caught
 * call still fires a `securitypolicyviolation` event, which fails the frontend's CSP tests
 * and adds console noise. `jitless` skips the probe; validation runs without runtime code
 * compilation, a little slower and irrelevant at these payload sizes.
 */
z.config({ jitless: true });
