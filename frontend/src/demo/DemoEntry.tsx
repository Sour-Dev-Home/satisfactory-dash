import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { LOGIN_MUTATION_KEY, SESSION_KEY } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";

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

  return (
    <section
      aria-labelledby="demo-entry-heading"
      className="mx-auto mt-6 grid w-full max-w-md gap-4 rounded-card border border-line bg-surface p-6"
    >
      <h2 id="demo-entry-heading">Satis Manager demo</h2>
      <p>
        A live dashboard for a Satisfactory dedicated server: power, production and server status at a glance.
        This demo runs on a made-up factory, so no sign-in is needed.
      </p>
      <button
        type="button"
        onClick={() => enter.mutate()}
        disabled={enter.isPending}
        className="border-accent bg-accent font-semibold text-on-accent hover:border-accent"
      >
        {enter.isPending ? "Opening…" : "Enter demo"}
      </button>
      {enter.isError && <ErrorNotice error={enter.error} />}
    </section>
  );
}
