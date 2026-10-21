import { useId, type ReactNode } from "react";
import { classifyError } from "../api/errors";
import { queries } from "../api/queries";
import { useSettledQuery } from "../api/settled";
import { useSelectedServer } from "../servers/ServerContext";
import { ErrorNotice } from "./ErrorNotice";

/**
 * A panel's own error. "Game server unreachable" is said once for the whole server, by the shell's
 * StatusBanners: when the status read says so too, the panel shows a quiet empty panel instead of a
 * second notice. Any other kind (contract drift, a bug, an unknown code), or an unreachable source the
 * status read doesn't share (FRM down while the game's own API answers), stays the panel's to say.
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
  // The shell's banners already poll status; this only reads the same cache entry (no timer, no mount fetch).
  const status = useSettledQuery({ ...queries.status(server.id), refetchOnMount: false, refetchInterval: false });
  if (isUnreachable(error) && isUnreachable(status.error)) return hasData ? null : <UnreachablePanel title={title} />;
  return <ErrorNotice error={error} action={action} />;
}

function isUnreachable(error: unknown): boolean {
  return error != null && classifyError(error) === "upstream_unreachable";
}

/** The panel's place while the game server is down: its heading and one muted line, no alert. */
export function UnreachablePanel({ title }: { title: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="panel" data-unreachable="">
      <h3 id={id}>{title}</h3>
      <p className="text-muted">No data while the game server is unreachable.</p>
    </section>
  );
}
