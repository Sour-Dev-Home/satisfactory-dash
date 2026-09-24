import { sourceUrl } from "../source";

/** Always rendered, outside the auth gate, so it's reachable from the login screen too. */
export function SourceFooter({ commitSha = __COMMIT_SHA__ }: { commitSha?: string }) {
  return (
    <footer className="border-t border-line py-6 text-sm text-muted">
      <a href={sourceUrl(commitSha)}>Source code (AGPL-3.0)</a>
    </footer>
  );
}
