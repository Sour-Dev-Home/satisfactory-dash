import { createContext, useContext } from "react";

/**
 * The signed-in operator, provided by AuthGate. Components read it here instead of
 * subscribing to the session query themselves: a new subscriber would refetch the session
 * on mount (no staleTime), sending an extra request right after every sign-in.
 */
export const SignedInUser = createContext<{ name: string } | null>(null);

export function useSignedInUser(): { name: string } | null {
  return useContext(SignedInUser);
}
