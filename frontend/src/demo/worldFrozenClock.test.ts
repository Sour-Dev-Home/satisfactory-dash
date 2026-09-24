import { describe, expect, it } from "vitest";
import { appendReading } from "../power/history";
import * as world from "./world";

// ADR-0026 `?clock=fixed`: repeated power() reads at DEMO_EPOCH must never look newer than the
// last point powerHistory() already reported, or appendReading (src/power/history.ts) would
// keep growing the client-side series even while the clock is supposedly frozen. This holds
// today only because DEMO_EPOCH lands exactly on a 5s sample boundary (it's on the hour); it's
// a coincidence of the chosen constant, not something the types enforce.
describe("the demo world stays frozen under a fixed clock", () => {
  it("does not let appendReading grow the history from a second frozen-time reading", () => {
    const history = world.powerHistory(world.DEMO_EPOCH).data;
    const reading = world.power(world.DEMO_EPOCH);
    const appended = appendReading(history, reading);
    expect(appended).toBe(history);
  });

  it("BRITTLE: relies on DEMO_EPOCH being an exact multiple of the 5s sample interval", () => {
    expect(world.DEMO_EPOCH % 5000).toBe(0);
  });
});
