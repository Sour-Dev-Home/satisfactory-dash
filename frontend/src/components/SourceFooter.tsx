import { sourceUrl } from "../source";

/** Always rendered, outside the auth gate, so it's reachable from the login screen too. */
export function SourceFooter({ commitSha = __COMMIT_SHA__ }: { commitSha?: string }) {
  return (
    <footer className="border-t border-line py-6 text-sm text-muted">
      {/* A 44 px hit area (#62) around the 20 px line; the negative margin keeps the footer's
          height, so the tap target grows without moving anything. */}
      <a href={sourceUrl(commitSha)} className="-my-[calc((44px-1lh)/2)] inline-flex min-h-[44px] items-center">
        Source code (AGPL-3.0)
      </a>
    </footer>
  );
}
