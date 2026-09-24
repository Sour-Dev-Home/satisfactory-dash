/**
 * Dev mock mode only (`npm run dev:mock`, `?crash=<section>`): throws once while rendering
 * the named section, so the ErrorBoundary fallback can be seen and reviewed. No fixture can
 * crash a view (every response is schema-checked first), hence this probe. MODE is a
 * build-time constant, so production builds reduce it to `return null`.
 */
const crashed = new Set<string>();

export function CrashProbe({ section }: { section: string }) {
  if (import.meta.env.MODE !== "mock") return null;
  const requested = new URLSearchParams(window.location.search).get("crash");
  // Throw only the first time, so "Try again" visibly recovers.
  if (requested === section && !crashed.has(section)) {
    crashed.add(section);
    throw new Error(`[crash probe] ${section}`);
  }
  return null;
}
