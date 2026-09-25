import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { classifyError } from "../api/errors";
import { signOutLocally } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";

/**
 * Sign out (this session) or sign out everywhere (every session of this account, ADR-0025
 * decision 4). A failure leaves you signed in: the session wasn't ended, so the screen must
 * not pretend it was. A 401 here means the session had already expired; the query client's
 * 401 handling covers that.
 */
export function LogoutButton({ everywhere = false }: { everywhere?: boolean }) {
  const client = useQueryClient();
  const logout = useMutation({
    mutationFn: () => apiSend(everywhere ? endpoints.auth.logoutAll : endpoints.auth.logout, undefined),
    onSuccess: (answer) => signOutLocally(client, answer),
  });

  return (
    <>
      <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
        {everywhere ? "Sign out everywhere" : "Sign out"}
      </button>
      {logout.isError && <SignOutError error={logout.error} />}
    </>
  );
}

function SignOutError({ error }: { error: unknown }) {
  // 503: the session store is down, so the session was NOT ended (ADR-0025): say so plainly.
  if (classifyError(error) === "service_unavailable") {
    return (
      // Styled by the global [role="alert"] rule, like every other error (index.css).
      <p role="alert">
        Couldn't sign out, try again.
      </p>
    );
  }
  return <ErrorNotice error={error} />;
}
