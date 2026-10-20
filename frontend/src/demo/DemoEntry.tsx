import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { LOGIN_MUTATION_KEY, SESSION_KEY } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { Hero } from "../landing/Hero";
import { cn } from "../lib/cn";
import { primaryButton } from "../ui/chip";

/**
 * The demo build's replacement for the sign-in form (ADR-0026): one button, no credentials.
 * It goes through the same login call and session update as the real form, answered by the
 * demo handlers, so everything after it runs the real app's code paths.
 */
export function DemoEntry() {
  const client = useQueryClient();
  const enter = useMutation({
    mutationKey: LOGIN_MUTATION_KEY,
    mutationFn: () => apiSend(endpoints.auth.login, { username: "demo", password: "demo" }),
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
