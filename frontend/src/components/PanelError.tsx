import { useId, type ReactNode } from "react";
import { useDeployGapPhase } from "../api/deployGap";
import { queries } from "../api/queries";
import { useSettledQuery } from "../api/settled";
import { useSelectedServer } from "../servers/ServerContext";
import { ErrorNotice } from "./ErrorNotice";
import { panelErrorKind } from "./panelErrorKind";

/**
 * A panel's own error. "Game server unreachable" is said once for the whole server, by the shell's
 * StatusBanners: when the status read says so too, the panel shows a quiet empty panel instead of a
 * second notice. Any other kind (contract drift, a bug, an unknown code), or an unreachable source the
 * status read doesn't share (FRM down while the game's own API answers), stays the panel's to say.
 * During a recent deploy gap (ADR-0054 D4) a panel with no data shows "Updating…" instead of an error.
 */
export function PanelError({
  error,
  title,
  hasData = false,
  action,
}: {
  error: unknown;
  /** The panel's heading, for the quiet empty panel. */
  title: string;
  /** The panel still shows its last data (a failed refetch): then there's no empty panel either. */
  hasData?: boolean;
  action?: ReactNode;
}) {
  const server = useSelectedServer();
  const phase = useDeployGapPhase();
  // The shell's banners already poll status; this only reads the same cache entry (no timer, no mount fetch).
  const status = useSettledQuery({ ...queries.status(server.id), refetchOnMount: false, refetchInterval: false });
  const kind = panelErrorKind(error, status.error, phase, hasData);
  if (kind === "updating") return <QuietPanel title={title} line="Updating…" kind="updating" />;
  if (kind === "unreachable") return hasData ? null : <UnreachablePanel title={title} />;
  return <ErrorNotice error={error} action={action} />;
}

/** The panel's place while the game server is down: its heading and one muted line, no alert. */
export function UnreachablePanel({ title }: { title: string }) {
  return <QuietPanel title={title} line="No data while the game server is unreachable." kind="unreachable" />;
}

function QuietPanel({ title, line, kind }: { title: string; line: string; kind: "unreachable" | "updating" }) {
  const id = useId();
  const marker = kind === "unreachable" ? { "data-unreachable": "" } : { "data-updating": "" };
  return (
    <section aria-labelledby={id} className="panel" {...marker}>
      <h3 id={id}>{title}</h3>
      <p className="text-muted">{line}</p>
    </section>
  );
}
