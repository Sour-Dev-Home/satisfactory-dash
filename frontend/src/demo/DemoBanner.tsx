import { markTourSeen } from "./tour/persistence";
import { tour } from "./tour/target";
import { startTour, useTour } from "./tour/tourStore";

/**
 * Shown on every screen of the demo build (ADR-0026), so no one mistakes it for a live server. Inside the app (where
 * the tour's host is mounted, ADR-0065 Decision 8) it offers "Take the tour", which starts the tour from its first step.
 */
export function DemoBanner() {
  const { hostReady } = useTour();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-info/40 bg-info-soft px-4 py-2 text-sm font-medium text-fg-strong">
      <p className="mb-0 flex-1">
        <span className="mr-2 rounded bg-info-solid px-1.5 py-0.5 text-xs font-semibold text-white uppercase">Demo</span>
        Demo data: nothing here is live. Changes you make stay in this tab and reset when you reload.
      </p>
      {hostReady && (
        <button
          type="button"
          {...tour("demo-banner-tour")}
          onClick={(e) => {
            markTourSeen();
            startTour(e.currentTarget);
          }}
          className="text-sm"
        >
          Take the tour
        </button>
      )}
    </div>
  );
}
