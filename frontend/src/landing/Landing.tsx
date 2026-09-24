import { Link } from "react-router";
import { REPO_URL } from "../source";

/** The live demo (ADR-0026): its own site, so it's a plain link, not a route. */
export const DEMO_URL = "https://demo.satis-manager.com";
const DOCS_URL = `${REPO_URL}/blob/main/docs-vault/wiki`;

const linkButton = "inline-flex min-h-[44px] items-center justify-center rounded-lg border px-[14px] font-semibold no-underline";

/** Only what ships today: a feature appears here when it's live, never before. */
const FEATURES = [
  {
    title: "Power",
    body: "Production, consumption and capacity for every circuit, battery charge and flow, and a five-minute history chart.",
  },
  {
    title: "Factory health",
    body: "Every machine's recipe and output rate, with backed-up and paused machines called out and filterable.",
  },
  {
    title: "Auto-pause",
    body: "Turn the server's auto-pause on or off from the dashboard, with the pending change shown until the server applies it.",
  },
];

/**
 * The public front page at / (main site only; the demo build keeps / for "Enter demo").
 * Static: no queries, no auth, no API calls, so it works while the game server's PC is off.
 * Its link-preview tags are static in index.html, since previews don't run JavaScript.
 */
export function Landing() {
  return (
    <div className="grid gap-12 pt-4 sm:pt-8">
      <section aria-labelledby="landing-heading" className="grid max-w-3xl gap-5">
        <h2 id="landing-heading" className="text-2xl leading-tight font-bold sm:text-3xl">
          A live dashboard for your Satisfactory dedicated server: power, production and machine health.
        </h2>
        <p className="text-muted">
          Satis Manager reads your server's live state and shows what needs attention, from a phone or a desktop.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a href={DEMO_URL} className={`${linkButton} border-accent bg-accent text-on-accent`}>
            Try the live demo
          </a>
          <Link to="/app" className={`${linkButton} border-line bg-surface-2 text-fg-strong hover:border-muted`}>
            Sign in
          </Link>
          <span className="text-sm text-muted">Sign-in is invite-only during the beta.</span>
        </div>
      </section>

      <figure className="grid gap-2">
        <img
          src="/og-image.png"
          width={1200}
          height={630}
          alt="The Overview in the demo: all systems operational, with the server, power and factory each marked operational."
          className="h-auto w-full rounded-card border border-line"
        />
        <figcaption className="text-sm text-muted">The Overview, from the live demo's made-up factory.</figcaption>
      </figure>

      <section aria-labelledby="features-heading" className="grid gap-4">
        <h2 id="features-heading">What it shows</h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ title, body }) => (
            <li key={title} className="rounded-card border border-line bg-surface p-5">
              <h3>{title}</h3>
              <p className="text-muted">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="built-heading" className="grid max-w-3xl gap-3">
        <h2 id="built-heading">How it's built</h2>
        <p className="text-muted">
          A React single-page app on Cloudflare, a Node and Express API reached through a Cloudflare Tunnel, Postgres,
          and one shared zod contract that both sides validate against.
        </p>
        <ul className="flex flex-wrap gap-x-6">
          <li>
            <a href={REPO_URL} className="inline-flex min-h-[44px] items-center">Source on GitHub</a>
          </li>
          <li>
            <a href={`${DOCS_URL}/decisions/README.md`} className="inline-flex min-h-[44px] items-center">
              Architecture decisions
            </a>
          </li>
          <li>
            <a href={`${DOCS_URL}/architecture/README.md`} className="inline-flex min-h-[44px] items-center">
              Architecture diagrams
            </a>
          </li>
        </ul>
      </section>

      <p className="text-sm text-muted">Not affiliated with Coffee Stain Studios. Satisfactory is their trademark.</p>
    </div>
  );
}
