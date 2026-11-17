import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SESSION_KEY } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { Hero } from "../landing/Hero";
import { cn } from "../lib/cn";
import { primaryButton } from "../ui/chip";
import { enterDemo } from "./session";

/**
 * The demo build's replacement for the sign-in screen (ADR-0026): one button, no credentials.
 * It signs the in-page demo session in (`enterDemo`) and puts that session in the cache, exactly as the
 * session query would answer it, so everything after it runs the real app's code paths.
 */
export function DemoEntry() {
  const client = useQueryClient();
  const enter = useMutation({
    mutationFn: async () => enterDemo(),
    onSuccess: async (session) => {
      await client.cancelQueries({ queryKey: SESSION_KEY });
      client.setQueryData(SESSION_KEY, session);
    },
  });

  // The landing page's hero (#444), with Enter demo as its one action.
  return (
    <div className="pt-2 sm:pt-6">
      <Hero
        headingId="demo-entry-heading"
        title="A live dashboard for a Satisfactory dedicated server: power, production and server status at a glance."
      >
        <p className="m-0 text-muted">This demo runs on a made-up factory, so no sign-in is needed.</p>
        <button
          type="button"
          onClick={() => enter.mutate()}
          disabled={enter.isPending}
          className={cn(primaryButton, "hover:border-accent")}
        >
          {enter.isPending ? "Opening…" : "Enter demo"}
        </button>
        {enter.isError && <ErrorNotice error={enter.error} />}
      </Hero>
    </div>
  );
}
