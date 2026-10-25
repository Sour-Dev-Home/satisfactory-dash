import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { useSelectedServer } from "../servers/ServerContext";
import { useDismissedUpdate } from "./dismissal";
import { installLink, securityText, unsupportedText, updateText } from "./noticeText";
import { updateNotices, type UpdateNotices } from "./notices";

/**
 * What a server's reported version needs, from its agent status and the version policy (ADR-0057 Decision 7). `null`
 * until both are read, when nothing was reported, and for a version this page cannot read: no placeholder, so the
 * banner row does not move for a server that needs nothing. The dashboard only informs; nothing here updates anything.
 */
export function useUpdateNotices(serverId: string): UpdateNotices | null {
  const agent = useQuery(queries.agentStatus(serverId)).data;
  const compat = useQuery(queries.compat()).data;
  return updateNotices(agent?.agentVersion, compat);
}

function Install({ kind }: { kind: UpdateNotices["kind"] }) {
  const link = installLink(kind);
  return link === null ? null : (
    <>
      {" "}
      <a href={link.href} target="_blank" rel="noreferrer noopener">
        {link.label}
      </a>
    </>
  );
}

/**
 * The shell's banners for the selected server. Security advisories (stronger styling) and an unsupported version stay
 * until the server is updated. "Update available" is shown only when nothing stronger is, since those already name the
 * version to move to, and it can be dismissed for the release it names.
 */
export function UpdateBanners() {
  const server = useSelectedServer();
  const notices = useUpdateNotices(server.id);
  const dismissal = useDismissedUpdate(server.id, notices?.kind ?? "agent", notices?.current ?? "");
  if (notices === null) return null;
  const { kind } = notices;
  const strong = notices.security.length > 0 || notices.unsupported;
  return (
    <>
      {notices.security.map((s) => (
        <div key={s.id ?? "min-safe"} role="status" className="banner banner-alarm" data-update="security">
          <span className="min-w-0 flex-1">
            {securityText(notices, s)}
            <Install kind={kind} />
          </span>
        </div>
      ))}
      {notices.unsupported && (
        <div role="status" className="banner banner-warning" data-update="unsupported">
          <span className="min-w-0 flex-1">
            {unsupportedText(notices)}
            <Install kind={kind} />
          </span>
        </div>
      )}
      {!strong && notices.updateAvailable && !dismissal.hidden && (
        <div role="status" className="banner banner-stale" data-update="available">
          <span className="min-w-0 flex-1">
            {updateText(notices)}
            <Install kind={kind} />
          </span>
          <button
            type="button"
            onClick={() => {
              // The button leaves with the banner, which would drop focus to <body>: put it on the page's heading.
              document.querySelector<HTMLElement>("main h2")?.focus();
              dismissal.dismiss();
            }}
            aria-label={`Dismiss the ${kind} update notice`}
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

/** One line for a server on the Servers page: the most important thing its versions say, or nothing. */
export function ServerUpdateLine({ serverId }: { serverId: string }) {
  const notices = useUpdateNotices(serverId);
  if (notices === null) return null;
  const tone = notices.security.length > 0 ? "text-bad" : notices.unsupported ? "text-warn" : "text-muted";
  const text =
    notices.security[0] !== undefined
      ? securityText(notices, notices.security[0])
      : notices.unsupported
        ? unsupportedText(notices)
        : updateText(notices);
  return (
    <p className={`mb-0 text-sm ${tone}`} data-update-line>
      {text}
      <Install kind={notices.kind} />
    </p>
  );
}
