import { createContext, useContext } from "react";

/**
 * The signed-in operator, provided by AuthGate. Components read it here instead of
 * subscribing to the session query themselves: a new subscriber would refetch the session
 * on mount (no staleTime), sending an extra request right after every sign-in.
 */
/** The account: its display name, and its email when it has one (Google sign-in). */
export interface Account {
  name: string;
  email?: string;
}

export const SignedInUser = createContext<Account | null>(null);

export function useSignedInUser(): Account | null {
  return useContext(SignedInUser);
}
