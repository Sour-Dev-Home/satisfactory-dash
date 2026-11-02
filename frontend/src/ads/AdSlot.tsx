import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { notifyManager, useQueryClient } from "@tanstack/react-query";
import type { PageQuery } from "../ui/usePageReveal";
import { AD_CLIENT, AD_UNITS, isAdUnitId, type AdPlacement } from "./config";
import { adsOn, requestAd } from "./google";

/**
 * True once every one of the page's primary queries has data. Read from the cache, not with useQueries: another
 * observer of the same polled reads would run its own refetch timers.
 */
function usePageHasData(queries: PageQuery[]): boolean {
  const client = useQueryClient();
  // Batched as useQuery's own store is: the cache announces a query being added while another component renders.
  const subscribe = useCallback((onChange: () => void) => client.getQueryCache().subscribe(notifyManager.batchCalls(onChange)), [client]);
  const snapshot = () => queries.length > 0 && queries.every((query) => client.getQueryData(query.queryKey) !== undefined);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * One AdSense slot below a page's panels (ADR-0021 amendment 3, build step 4; amendment 2 Decision 6, amendment 1
 * Decision 4). It renders nothing, and so reserves no space, unless all of these hold:
 * - ads are on (the Worker's marker is in the page: src/ads/google.ts `adsOn`);
 * - the placement has an ad unit id (src/ads/config.ts; placeholders until the owner creates the units);
 * - every primary query of the page has data, so the slot never sits on a loading, empty or error-only page (E16).
 * Then it reserves a fixed size (tokens `--spacing-ad-*`, Google's exact-size example, U-E5), labelled
 * "Advertisements", the one label besides "Sponsored Links" Google allows (E18), and asks AdSense to fill it once. An
 * unfilled or blocked ad leaves the reserved space blank (U-E6): no error, no retry. Never in a modal, never over game
 * data: the shell places it after the page's sections, on Overview, Power, Factory and Planner only.
 */
export function AdSlot({
  placement,
  queries,
  units = AD_UNITS,
}: {
  placement: AdPlacement;
  /** The page's primary queries (shell/pageQueries.ts). */
  queries: PageQuery[];
  /** For tests: the unit ids. */
  units?: Readonly<Record<AdPlacement, string | null>>;
}) {
  const unit = units[placement];
  // Off (the default): nothing at all, not even a cache subscription.
  if (!adsOn() || !isAdUnitId(unit)) return null;
  return <WhenPageHasData placement={placement} unit={unit} queries={queries} />;
}

function WhenPageHasData({ placement, unit, queries }: { placement: AdPlacement; unit: string; queries: PageQuery[] }) {
  return usePageHasData(queries) ? <AdUnit placement={placement} unit={unit} /> : null;
}

function AdUnit({ placement, unit }: { placement: AdPlacement; unit: string }) {
  const labelId = useId();
  // One request per rendered unit: StrictMode's second mount keeps the ref, and AdSense rejects a second push for it.
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    requestAd();
  }, []);
  return (
    // A section (a region), not an aside: a complementary landmark inside <main> is not top-level, and the Planner's
    // inspector is already the page's complementary one. mt-8 adds to the page's gap, so the ad sits well clear of the
    // controls above it (E18's accidental clicks; ui-reviewer). max-w-full: on a screen under 352 px the 320 px unit
    // narrows rather than scroll the page (WCAG 1.4.10).
    <section aria-labelledby={labelId} data-ad-placement={placement} className="mt-8 grid min-w-0 justify-items-center gap-1">
      <p id={labelId} className="m-0 text-xs text-muted">
        Advertisements
      </p>
      <ins
        className="adsbygoogle block max-w-full h-ad-phone-h w-ad-phone-w sm:h-ad-mid-h sm:w-ad-mid-w lg:h-ad-wide-h lg:w-ad-wide-w"
        data-ad-client={AD_CLIENT}
        data-ad-slot={unit}
      />
    </section>
  );
}
