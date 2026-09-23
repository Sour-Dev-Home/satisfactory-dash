import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { LoginForm } from "./LoginForm";
import { LogoutButton } from "./LogoutButton";

/**
 * Shows the app only for a signed-in operator (ADR-0011). The session query is the single
 * source of truth: login sets it, and logout or any 401 resets it (see queries.ts).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useQuery(queries.session());

  // Check data before error: a failed background refetch keeps the last known session
  // rather than throwing the operator out of the app.
  if (session.data) {
    if (!session.data.authenticated) return <LoginForm />;
    return (
      <>
        <div className="account">
          <span>Signed in as {session.data.user.name}</span> <LogoutButton />
        </div>
        {children}
      </>
    );
  }
  if (session.isError) {
    return (
      <ErrorNotice
        error={session.error}
        action={
          <button type="button" onClick={() => void session.refetch()}>
            Retry
          </button>
        }
      />
    );
  }
  return <p role="status">Checking session…</p>;
}
