// AGPL-3.0 §13 (ADR-0018): the running site offers its source to every network user,
// signed in or not. Link to the exact deployed commit when the build knows it.

export const REPO_URL = "https://github.com/Sour-Dev-Home/satisfactory-dash";

/**
 * The source link for a build. `commitSha` comes from Cloudflare Workers Builds
 * (WORKERS_CI_COMMIT_SHA, see vite.config.ts); anything that isn't a commit hash, including
 * the empty value in local dev and GitHub CI, falls back to the repository root. Lowercase
 * only: that's what git and Cloudflare produce.
 */
export function sourceUrl(commitSha: string): string {
  return /^[0-9a-f]{7,40}$/.test(commitSha) ? `${REPO_URL}/tree/${commitSha}` : REPO_URL;
}
