const CORNERS = ["top-2 left-2", "top-2 right-2", "bottom-2 left-2", "bottom-2 right-2"];

/**
 * A panel's corner rivets (ADR-0041 item 4): decoration only, never meaning. The panel must be
 * `relative`; the rivets sit in its padding, so they never cover content or change its layout.
 */
export function Rivets() {
  return (
    <>
      {CORNERS.map((corner) => (
        <span key={corner} aria-hidden="true" data-rivet="" className={`pointer-events-none absolute ${corner} size-1.5 rounded-full bg-line`} />
      ))}
    </>
  );
}
