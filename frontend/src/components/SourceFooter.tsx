import { IS_DEMO } from "../demo/mode";
import { sourceUrl } from "../source";

/**
 * The privacy and terms pages are static files on the main site (public/privacy.html,
 * public/terms.html). The demo doesn't ship its own copies: it links to the main site's.
 */
const LEGAL_ORIGIN = IS_DEMO ? "https://satis-manager.com" : "";
export const PRIVACY_URL = `${LEGAL_ORIGIN}/privacy`;
export const TERMS_URL = `${LEGAL_ORIGIN}/terms`;

// A 44 px hit area (#62) around the 20 px line; the negative margin keeps the footer's height,
// so the tap target grows without moving anything.
const link = "-my-[calc((44px-1lh)/2)] inline-flex min-h-[44px] items-center";

/** Always rendered, outside the auth gate, so it's reachable from the login screen too. */
export function SourceFooter({ commitSha = __COMMIT_SHA__ }: { commitSha?: string }) {
  return (
    <footer className="flex flex-wrap gap-x-6 border-t border-line py-6 text-sm text-muted">
      <a href={sourceUrl(commitSha)} className={link}>
        Source code (AGPL-3.0)
      </a>
      <a href={PRIVACY_URL} className={link}>
        Privacy
      </a>
      <a href={TERMS_URL} className={link}>
        Terms
      </a>
    </footer>
  );
}
