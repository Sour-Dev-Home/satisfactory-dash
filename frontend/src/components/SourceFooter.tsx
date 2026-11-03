import { useSyncExternalStore } from "react";
import { CHANGELOG_PATH, GUIDES_PATH } from "../../site/paths";
import { adsOn, showPrivacySettings } from "../ads/google";
import { IS_DEMO } from "../demo/mode";
import { cn } from "../lib/cn";
import { sourceUrl } from "../source";

const noSubscription = () => () => {};
const adsOffOnServer = () => false;

/**
 * The Worker's ads marker, read so hydration matches: the build prerenders the landing page without it (the Worker adds
 * it per response), so hydration starts from the server snapshot (off) and React re-renders with the marker's value,
 * rather than reporting a mismatch. The marker never changes while a page is open.
 */
function useAdsOn(): boolean {
  return useSyncExternalStore(noSubscription, adsOn, adsOffOnServer);
}

/**
 * The privacy and terms pages are static files on the main site (public/privacy.html,
 * public/terms.html). The demo doesn't ship its own copies: it links to the main site's.
 */
const LEGAL_ORIGIN = IS_DEMO ? "https://satis-manager.com" : "";
export const PRIVACY_URL = `${LEGAL_ORIGIN}/privacy`;
export const TERMS_URL = `${LEGAL_ORIGIN}/terms`;

// A 44 px hit area (#62) around the 20 px line; the negative margin keeps the footer's height,
// so the tap target grows without moving anything.
const link = "-my-touch-bleed inline-flex min-h-touch items-center";

/**
 * Always rendered, outside the auth gate, so it's reachable from the login screen too. The landing page and the app
 * share it. With ads on (ADR-0021 amendment 3, build step 4) it adds "Privacy and cookie settings", which opens
 * Google's consent message again (E10). It is a button, not E10's `javascript:` link, which the ads-on CSP blocks, and
 * it opens a dialog rather than going anywhere. The US "Do Not Sell or Share" link is not here: on an AdSense site
 * Google's US state regulations message renders it itself (a site's own link is Ad Manager only, U-E1, U-E2).
 */
export function SourceFooter({ commitSha = __COMMIT_SHA__, publicPages = false }: { commitSha?: string; publicPages?: boolean }) {
  const ads = useAdsOn();
  return (
    <footer className="flex flex-wrap gap-x-6 border-t border-line py-6 text-sm text-muted">
      {/* The landing page's footer only (App): plain links, since these are static pages outside the SPA. */}
      {publicPages && (
        <>
          <a href={GUIDES_PATH} className={link}>
            Guides
          </a>
          <a href={CHANGELOG_PATH} className={link}>
            Changelog
          </a>
        </>
      )}
      <a href={sourceUrl(commitSha)} className={link}>
        Source code (AGPL-3.0)
      </a>
      <a href={PRIVACY_URL} className={link}>
        Privacy
      </a>
      <a href={TERMS_URL} className={link}>
        Terms
      </a>
      {ads && (
        <button
          type="button"
          onClick={() => showPrivacySettings()}
          className={cn(link, "rounded-control border-0 bg-transparent p-0 font-normal text-accent underline underline-offset-2")}
        >
          Privacy and cookie settings
        </button>
      )}
    </footer>
  );
}
