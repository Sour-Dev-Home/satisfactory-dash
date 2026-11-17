import type { CreatedSession, SessionStore, SessionUser } from "./sessionStore.js";

/**
 * No-database mode (no DATABASE_URL): Google is the only way in and needs the database, so
 * nobody can sign in (ADR-0025 PR 9). Every cookie is "signed out", and any old cookie is
 * cleared because this store recognizes none. Nothing creates a session here.
 */
export function createNoSessionStore(): SessionStore {
  return {
    async create(): Promise<CreatedSession> {
      throw new Error("Sign-in needs the database (no DATABASE_URL is set).");
    },
    async resolve(): Promise<SessionUser | null> {
      return null;
    },
    async revoke(): Promise<void> {},
    async revokeAllFor(): Promise<number> {
      return 0;
    },
    recognizes(): boolean {
      return false;
    },
  };
}
