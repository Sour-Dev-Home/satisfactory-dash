import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { isUniqueViolation } from "../../../platform/db/errors.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import { RowShapeError } from "../../../platform/db/rows.js";
import { addIdentity, createUser, findUserByIdentity, getUserById, setUserStatus } from "./userRepository.js";
import {
  createSession,
  deleteExpiredSessions,
  findActiveSession,
  hashSessionId,
  newSessionId,
  revokeAllSessions,
  revokeAllSessionsForUser,
  revokeSession,
  touchSession,
} from "./sessionRepository.js";
import {
  consumeLoginAttempt,
  createLoginAttempt,
  deleteExpiredLoginAttempts,
  hashLoginAttemptId,
  newLoginAttemptId,
} from "./loginAttemptRepository.js";

// Runs as satis_app (the runtime role) against a real Postgres: what production will do.
const available = dbTestsAvailable();

describe.skipIf(!available)("identity repositories against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 5 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  describe("users and identities", () => {
    it("creates a user, trimming the name and lowercasing the email, and reads it back", async () => {
      const user = await createUser(pool, { displayName: "  Ann  ", email: "  Ann@Example.COM " });
      expect(user).toMatchObject({ displayName: "Ann", email: "ann@example.com", status: "active" });
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(await getUserById(pool, user.id)).toEqual(user);
    });

    it("stores no email for a blank one, and returns undefined for an unknown id", async () => {
      expect((await createUser(pool, { displayName: "NoMail", email: "   " })).email).toBeNull();
      expect(await getUserById(pool, "00000000-0000-4000-8000-000000000000")).toBeUndefined();
    });

    it("finds a user by provider identity, never by email", async () => {
      const user = await createUser(pool, { displayName: "G", email: "g@example.com" });
      await addIdentity(pool, { userId: user.id, provider: "google", subject: "google-sub-1" });
      expect(await findUserByIdentity(pool, "google", "google-sub-1")).toEqual(user);
      expect(await findUserByIdentity(pool, "google", "g@example.com")).toBeUndefined();
      expect(await findUserByIdentity(pool, "local", "google-sub-1")).toBeUndefined();
    });

    it("refuses a second owner of the same identity and a second identity per provider (23505)", async () => {
      const a = await createUser(pool, { displayName: "A" });
      const b = await createUser(pool, { displayName: "B" });
      await addIdentity(pool, { userId: a.id, provider: "google", subject: "taken" });
      await expect(addIdentity(pool, { userId: b.id, provider: "google", subject: "taken" })).rejects.toSatisfy(isUniqueViolation);
      await expect(addIdentity(pool, { userId: a.id, provider: "google", subject: "another" })).rejects.toSatisfy(isUniqueViolation);
    });

    it("sign-up in one transaction: a failure leaves neither the user nor the identity behind", async () => {
      const existing = await createUser(pool, { displayName: "Existing" });
      await addIdentity(pool, { userId: existing.id, provider: "google", subject: "dup-sub" });
      await expect(
        withTransaction(pool, async (client) => {
          const fresh = await createUser(client, { displayName: "Ghost", email: "ghost@example.com" });
          await addIdentity(client, { userId: fresh.id, provider: "google", subject: "dup-sub" });
        }),
      ).rejects.toSatisfy(isUniqueViolation);
      expect((await admin.query("SELECT 1 FROM identity.users WHERE email = 'ghost@example.com'")).rows).toEqual([]);
    });

    it("disables and re-enables an account; false for an unknown user", async () => {
      const user = await createUser(pool, { displayName: "Toggle" });
      expect(await setUserStatus(pool, user.id, "disabled")).toBe(true);
      expect((await getUserById(pool, user.id))?.status).toBe("disabled");
      expect(await setUserStatus(pool, user.id, "active")).toBe(true);
      expect(await setUserStatus(pool, "00000000-0000-4000-8000-000000000000", "disabled")).toBe(false);
    });
  });

  describe("sessions", () => {
    it("newSessionId is 32 random bytes; only its sha256 is what the table stores", () => {
      const a = newSessionId();
      const b = newSessionId();
      expect(a.id).not.toBe(b.id);
      expect(Buffer.from(a.id, "base64url")).toHaveLength(32);
      expect(a.idHash).toHaveLength(32);
      expect(a.idHash.equals(hashSessionId(a.id))).toBe(true);
      expect(a.idHash.equals(Buffer.from(a.id, "base64url"))).toBe(false);
    });

    it("an active session resolves to its user; the row holds the hash, not the id", async () => {
      const user = await createUser(pool, { displayName: "Sess", email: "sess@example.com" });
      const { id, idHash } = newSessionId();
      await createSession(pool, { idHash, userId: user.id, ttlSeconds: 8 * 3600 });
      const found = await findActiveSession(pool, hashSessionId(id));
      expect(found).toMatchObject({ userId: user.id, displayName: "Sess", email: "sess@example.com" });
      expect(found!.expiresAt.getTime() - Date.now()).toBeGreaterThan(7.9 * 3600_000);
      const stored = await admin.query("SELECT id_hash FROM identity.sessions WHERE user_id = $1", [user.id]);
      expect(stored.rows[0].id_hash.equals(idHash)).toBe(true);
      expect(JSON.stringify(stored.rows)).not.toContain(id);
    });

    it("an unknown, wrongly hashed, revoked, expired or disabled-account session is not active", async () => {
      const user = await createUser(pool, { displayName: "Gone" });
      const live = newSessionId();
      await createSession(pool, { idHash: live.idHash, userId: user.id, ttlSeconds: 3600 });
      expect(await findActiveSession(pool, hashSessionId("not-a-real-id"))).toBeUndefined();
      expect(await findActiveSession(pool, Buffer.from(live.id))).toBeUndefined(); // the raw id is not the hash

      const revoked = newSessionId();
      await createSession(pool, { idHash: revoked.idHash, userId: user.id, ttlSeconds: 3600 });
      expect(await revokeSession(pool, revoked.idHash)).toBe(user.id); // the user id, for the audit row
      expect(await findActiveSession(pool, revoked.idHash)).toBeUndefined();
      expect(await revokeSession(pool, revoked.idHash)).toBeUndefined(); // already revoked

      const expired = newSessionId();
      await createSession(pool, { idHash: expired.idHash, userId: user.id, ttlSeconds: 3600 });
      await admin.query("UPDATE identity.sessions SET expires_at = now() - interval '1 second', created_at = now() - interval '2 hours' WHERE id_hash = $1", [expired.idHash]);
      expect(await findActiveSession(pool, expired.idHash)).toBeUndefined();

      expect(await findActiveSession(pool, live.idHash)).toBeDefined();
      await setUserStatus(pool, user.id, "disabled");
      expect(await findActiveSession(pool, live.idHash)).toBeUndefined();
    });

    it("touchSession writes at most once a minute", async () => {
      const user = await createUser(pool, { displayName: "Touch" });
      const { idHash } = newSessionId();
      await createSession(pool, { idHash, userId: user.id, ttlSeconds: 3600 });
      expect(await touchSession(pool, idHash)).toBe(true); // first sighting
      expect(await touchSession(pool, idHash)).toBe(false); // within the minute
      await admin.query("UPDATE identity.sessions SET last_seen_at = now() - interval '2 minutes' WHERE id_hash = $1", [idHash]);
      expect(await touchSession(pool, idHash)).toBe(true);
      await revokeSession(pool, idHash);
      expect(await touchSession(pool, idHash)).toBe(false); // a revoked session is not "seen"
    });

    // test-hunter (needs CI, not run locally): an expired session is not "seen".
    it("touchSession does not write to an expired session", async () => {
      const user = await createUser(pool, { displayName: "TouchExpired" });
      const { idHash } = newSessionId();
      await createSession(pool, { idHash, userId: user.id, ttlSeconds: 3600 });
      await admin.query(
        "UPDATE identity.sessions SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE id_hash = $1",
        [idHash],
      );
      expect(await touchSession(pool, idHash)).toBe(false);
    });

    it("sign out everywhere revokes one user's sessions only; revoke-all revokes everyone's", async () => {
      const a = await createUser(pool, { displayName: "A" });
      const b = await createUser(pool, { displayName: "B" });
      const sessions = [a, a, b].map(() => newSessionId());
      await createSession(pool, { idHash: sessions[0].idHash, userId: a.id, ttlSeconds: 3600 });
      await createSession(pool, { idHash: sessions[1].idHash, userId: a.id, ttlSeconds: 3600 });
      await createSession(pool, { idHash: sessions[2].idHash, userId: b.id, ttlSeconds: 3600 });
      expect(await revokeAllSessionsForUser(pool, a.id)).toBe(2);
      expect(await findActiveSession(pool, sessions[0].idHash)).toBeUndefined();
      expect(await findActiveSession(pool, sessions[2].idHash)).toBeDefined();
      expect(await revokeAllSessionsForUser(pool, a.id)).toBe(0);
      expect(await revokeAllSessions(pool)).toBeGreaterThanOrEqual(1);
      expect(await findActiveSession(pool, sessions[2].idHash)).toBeUndefined();
    });

    it("housekeeping drops only sessions that expired more than 30 days ago, in batches", async () => {
      const user = await createUser(pool, { displayName: "Old" });
      const old = newSessionId();
      const recent = newSessionId();
      await createSession(pool, { idHash: old.idHash, userId: user.id, ttlSeconds: 3600 });
      await createSession(pool, { idHash: recent.idHash, userId: user.id, ttlSeconds: 3600 });
      await admin.query("UPDATE identity.sessions SET created_at = now() - interval '40 days', expires_at = now() - interval '31 days' WHERE id_hash = $1", [old.idHash]);
      await admin.query("UPDATE identity.sessions SET created_at = now() - interval '20 days', expires_at = now() - interval '10 days' WHERE id_hash = $1", [recent.idHash]);
      // A batch of one leaves the rest for the next call.
      const extra = newSessionId();
      await createSession(pool, { idHash: extra.idHash, userId: user.id, ttlSeconds: 3600 });
      await admin.query("UPDATE identity.sessions SET created_at = now() - interval '50 days', expires_at = now() - interval '45 days' WHERE id_hash = $1", [extra.idHash]);
      expect(await deleteExpiredSessions(pool, 1)).toBe(1);
      expect(await deleteExpiredSessions(pool, 1)).toBe(1);
      expect(await deleteExpiredSessions(pool, 1)).toBe(0);
      expect((await admin.query("SELECT 1 FROM identity.sessions WHERE id_hash = $1", [old.idHash])).rows).toEqual([]);
      expect((await admin.query("SELECT 1 FROM identity.sessions WHERE id_hash = $1", [extra.idHash])).rows).toEqual([]);
      expect((await admin.query("SELECT 1 FROM identity.sessions WHERE id_hash = $1", [recent.idHash])).rows).toHaveLength(1);
    });

    it("refuses a session for a user that does not exist (foreign key)", async () => {
      await expect(
        createSession(pool, { idHash: newSessionId().idHash, userId: "00000000-0000-4000-8000-000000000000", ttlSeconds: 60 }),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });

  describe("login attempts (OIDC state, single use)", () => {
    const attempt = (returnPath = "/app/servers") => ({
      state: "s".repeat(32),
      nonce: "n".repeat(32),
      codeVerifier: "v".repeat(64),
      returnPath,
    });

    it("stores the hash of the id, and consuming returns the attempt exactly once", async () => {
      const { id, idHash } = newLoginAttemptId();
      expect(hashLoginAttemptId(id).equals(idHash)).toBe(true);
      await createLoginAttempt(pool, { idHash, ...attempt() });
      expect(await consumeLoginAttempt(pool, hashLoginAttemptId(id))).toEqual(attempt());
      expect(await consumeLoginAttempt(pool, hashLoginAttemptId(id))).toBeUndefined(); // replay finds nothing
    });

    it("two concurrent callbacks: exactly one wins", async () => {
      const { idHash } = newLoginAttemptId();
      await createLoginAttempt(pool, { idHash, ...attempt() });
      const results = await Promise.all(Array.from({ length: 6 }, () => consumeLoginAttempt(pool, idHash)));
      expect(results.filter((r) => r !== undefined)).toHaveLength(1);
    });

    it("an expired attempt cannot be consumed, and housekeeping removes it", async () => {
      const { idHash } = newLoginAttemptId();
      await createLoginAttempt(pool, { idHash, ...attempt() });
      await admin.query("UPDATE identity.login_attempts SET created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes' WHERE id_hash = $1", [idHash]);
      expect(await consumeLoginAttempt(pool, idHash)).toBeUndefined();
      expect(await deleteExpiredLoginAttempts(pool)).toBeGreaterThanOrEqual(1);
      expect((await admin.query("SELECT 1 FROM identity.login_attempts WHERE id_hash = $1", [idHash])).rows).toEqual([]);
    });

    it("refuses an off-site or non-ASCII return path in the repository, before the database is asked", async () => {
      for (const path of ["//evil.example", "https://evil.example/app", "/elsewhere", "/app/a b", "/app\\x"]) {
        await expect(createLoginAttempt(pool, { idHash: newLoginAttemptId().idHash, ...attempt(path) })).rejects.toThrow(RangeError);
      }
      expect((await admin.query("SELECT count(*)::int AS n FROM identity.login_attempts WHERE return_path LIKE '//%'")).rows[0].n).toBe(0);
    });

    it("lets an attempt live about ten minutes", async () => {
      const { idHash } = newLoginAttemptId();
      await createLoginAttempt(pool, { idHash, ...attempt() });
      const row = (await admin.query("SELECT extract(epoch FROM (expires_at - created_at)) AS secs FROM identity.login_attempts WHERE id_hash = $1", [idHash])).rows[0];
      expect(Number(row.secs)).toBeGreaterThan(590);
      expect(Number(row.secs)).toBeLessThan(610);
    });
  });

  describe("row shape parsing", () => {
    it("a drifted schema fails loudly at the repository boundary, without echoing the row", async () => {
      const user = await createUser(pool, { displayName: "Shape", email: "shape@example.com" });
      // Simulate drift: a status the code does not know (the CHECK is dropped for this one row's table copy).
      await admin.query("ALTER TABLE identity.users DROP CONSTRAINT users_status_check");
      await admin.query("UPDATE identity.users SET status = 'surprise' WHERE id = $1", [user.id]);
      let error: unknown;
      try {
        await getUserById(pool, user.id);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(RowShapeError);
      expect((error as Error).message).not.toContain("shape@example.com");
      await admin.query("UPDATE identity.users SET status = 'active' WHERE id = $1", [user.id]);
      await admin.query("ALTER TABLE identity.users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled'))");
    });
  });
});
