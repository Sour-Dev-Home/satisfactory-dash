/** Shown on every screen of the demo build (ADR-0026), so no one mistakes it for a live server. */
export function DemoBanner() {
  return (
    <p className="rounded-card border border-info/40 bg-info-soft px-4 py-2 text-sm font-medium text-fg-strong">
      <span className="mr-2 rounded bg-info-solid px-1.5 py-0.5 text-xs font-semibold text-white uppercase">Demo</span>
      Demo data: nothing here is live. Changes you make stay in this tab and reset when you reload.
    </p>
  );
}
