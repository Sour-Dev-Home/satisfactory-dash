import { SkeletonLine } from "../../ui/Skeleton";
import { formatMW } from "../../format";
import { cn } from "../../lib/cn";
import { useReducedMotion } from "../reducedMotion";
import { capacityShare, type PowerState } from "./power";
import { Rivets } from "./Rivets";
import "./power.css";

/**
 * A thin circuit: its dashes flow while power is drawn and stand still at 0 MW and under reduced
 * motion. An SVG line, so the animation moves only the dash offset (power.css).
 */
export function CircuitStrip({ drawing }: { drawing: boolean }) {
  const reduced = useReducedMotion();
  const flowing = drawing && !reduced;
  return (
    <svg aria-hidden="true" focusable="false" data-flowing={flowing} className="h-2 w-full text-accent">
      <line x1="0" y1="50%" x2="100%" y2="50%" className="text-line" stroke="currentColor" strokeWidth={2} />
      <line
        x1="0"
        y1="50%"
        x2="100%"
        y2="50%"
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray="8 8"
        className={cn(flowing ? "circuit-flow" : "opacity-60")}
      />
    </svg>
  );
}

/** The capacity bar: amber up to consumption over capacity. Hidden: the text under it says the same. */
function CapacityBar({ share }: { share: number }) {
  return (
    <svg aria-hidden="true" focusable="false" data-share={share} className="h-3 w-full rounded-sm">
      <rect width="100%" height="100%" className="fill-surface-2" />
      <rect width={`${share * 100}%`} height="100%" className="fill-accent" />
    </svg>
  );
}

/**
 * The Power card (#442): the whole grid as a flowing circuit and a capacity bar, "4,396 MW of
 * 6,150 MW". Amber is power here, never a status: whether power is healthy is the Power tile's word.
 */
export function PowerCard({ state }: { state: PowerState }) {
  return (
    <section aria-labelledby="power-heading" className="relative grid gap-3 rounded-card border border-line bg-surface p-5">
      <Rivets />
      <h3 id="power-heading" className="mb-0">
        Power
      </h3>
      <PowerBody state={state} />
    </section>
  );
}

function PowerBody({ state }: { state: PowerState }) {
  if (state === "pending") return <SkeletonLine label="Loading…" />;
  if (state === "updating") return <p className="mb-0 text-muted">Updating…</p>;
  if (state === "error") return <p className="mb-0 text-muted">Couldn't load the power grid.</p>;
  if (state.circuits === 0) return <p className="mb-0 text-muted">No power circuits yet.</p>;
  return (
    <>
      <CircuitStrip drawing={state.consumptionMW > 0} />
      <CapacityBar share={capacityShare(state)} />
      <p className="mb-0">
        <span className="font-semibold text-fg-strong">{formatMW(state.consumptionMW)}</span>
        <span className="text-muted"> of {formatMW(state.capacityMW)}</span>
      </p>
    </>
  );
}
