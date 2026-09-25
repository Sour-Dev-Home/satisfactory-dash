import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { DemoEntry } from "../demo/DemoEntry";
import { IS_DEMO } from "../demo/mode";
import { LoginForm } from "./LoginForm";
import { SignedInUser } from "./SignedInUser";

/**
 * Shows the app only for a signed-in operator (ADR-0011). The session query is the single
 * source of truth: login sets it, and logout or any 401 resets it (see queries.ts).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useQuery(queries.session());

  // Check data before error: a failed background refetch keeps the last known session
  // rather than throwing the operator out of the app.
  if (session.data) {
    // The demo build (ADR-0026) has one "Enter demo" button instead of a credential form.
    if (!session.data.authenticated) {
      return IS_DEMO ? <DemoEntry /> : <LoginForm signInMethods={session.data.signInMethods} />;
    }
    // The account name and Sign out render in the shell's top bar (AccountMenu).
    return <SignedInUser value={session.data.user}>{children}</SignedInUser>;
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
