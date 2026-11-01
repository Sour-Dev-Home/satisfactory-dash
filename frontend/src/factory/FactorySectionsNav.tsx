import { Link, useLocation } from "react-router";
import { HISTORY_ANCHOR, MACHINES_ANCHOR } from "../lib/deepLinks";
import { BOTTLENECKS_ANCHOR } from "./bottlenecksRead";

/** The page's sections in page order, each by the id its own `useHashTarget` jumps to. */
const SECTIONS = [
  { anchor: MACHINES_ANCHOR, label: "Machines" },
  { anchor: HISTORY_ANCHOR, label: "History" },
  { anchor: BOTTLENECKS_ANCHOR, label: "Bottlenecks" },
] as const;

/**
 * ADR-0062 F.4: an in-page nav for the Factory page, on the fragments the sections already honour (#history,
 * #bottlenecks, and now #machines). Each section scrolls itself into view and moves focus to its heading
 * (lib/useHashTarget); this only changes the hash. The search (?q=, ?item=, a scenario) is kept, as the bottleneck
 * summary's "Full list" link does.
 */
export function FactorySectionsNav() {
  const location = useLocation();
  return (
    <nav aria-label="Factory sections">
      {/* Tailwind's reset drops the markers, and Safari then drops the list role: say it. */}
      <ul role="list" className="flex flex-wrap gap-x-4">
        {SECTIONS.map((s) => (
          <li key={s.anchor}>
            <Link
              to={{ search: location.search, hash: `#${s.anchor}` }}
              // Always a push: on the same URL react-router would replace, keep the history index and so the section's
              // once-per-navigation jump would not fire again after the reader scrolled away (as in BottleneckSummary).
              replace={false}
              className="inline-flex min-h-touch items-center text-sm"
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
