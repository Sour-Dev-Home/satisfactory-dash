import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { signOutLocally } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";

/** A 401 here means the session had already expired; the query client's 401 handling covers it. */
export function LogoutButton() {
  const client = useQueryClient();
  const logout = useMutation({
    mutationFn: () => apiSend(endpoints.auth.logout, undefined),
    onSuccess: () => signOutLocally(client),
  });

  return (
    <>
      <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
        Log out
      </button>
      {logout.isError && <ErrorNotice error={logout.error} />}
    </>
  );
}
