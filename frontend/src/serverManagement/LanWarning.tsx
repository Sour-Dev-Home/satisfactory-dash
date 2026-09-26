/**
 * ADR-0030: a server that isn't on this machine (plainHttpOverLan). Names both tokens: FRM is plain
 * HTTP, and the game API's certificate isn't verified on LAN hosts. Kept for when certificate
 * pinning ships and LAN servers are allowed again.
 */
export function LanWarning() {
  return (
    <p className="rounded-lg border border-warn/40 bg-warn-soft px-3.5 py-3 text-sm text-fg-strong">
      This server is on your network, not this machine. FicsitRemoteMonitoring has no HTTPS, so its token and data
      travel unencrypted, and the game API's certificate isn't verified on local network hosts. Both tokens and the
      FRM data could be intercepted on the local network.
    </p>
  );
}
