import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";

// ADR-0025 PR 3: the rules live in constraints, so they are tested against the real schema with
// raw SQL (no repository in the way). Every constraint below is one a repository bug could break.
const available = dbTestsAvailable();

const HASH = (n: number) => Buffer.alloc(32, n);
const LONG = (c: string, n = 64) => c.repeat(n);

describe.skipIf(!available)("core schema constraints", () => {
  let db: TestDatabase;
  let admin: pg.Pool;
  let app: pg.Pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 3 });
    app = new pg.Pool({ connectionString: db.appUrl, max: 3 });
  }, 60_000);

  afterAll(async () => {
    await admin?.end();
    await app?.end();
    await db?.drop();
  });

  const user = async (name = "u", email: string | null = null) =>
    (await admin.query("INSERT INTO identity.users (display_name, email) VALUES ($1, $2) RETURNING id", [name, email])).rows[0].id as string;
  const server = async (publicId: string) =>
    (await admin.query("INSERT INTO servers.servers (public_id, display_name) VALUES ($1, 'S') RETURNING id", [publicId])).rows[0].id as string;
  const rejects = (promise: Promise<unknown>, code: string, constraint?: string) =>
    expect(promise).rejects.toMatchObject(constraint ? { code, constraint } : { code });

  describe("identity.users", () => {
    it("defaults to an active account with an id and a creation time", async () => {
      const row = (await admin.query("INSERT INTO identity.users (display_name) VALUES ('Ann') RETURNING *")).rows[0];
      expect(row).toMatchObject({ display_name: "Ann", email: null, status: "active" });
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.created_at).toBeInstanceOf(Date);
    });

    it("refuses an empty or over-long name, an unknown status and a non-lowercase or malformed email (23514)", async () => {
      await rejects(admin.query("INSERT INTO identity.users (display_name) VALUES ('')"), "23514");
      await rejects(admin.query("INSERT INTO identity.users (display_name) VALUES ($1)", [LONG("x", 101)]), "23514");
      await rejects(admin.query("INSERT INTO identity.users (display_name, status) VALUES ('a', 'banned')"), "23514");
      await rejects(admin.query("INSERT INTO identity.users (display_name, email) VALUES ('a', 'Mixed@Example.com')"), "23514");
      await rejects(admin.query("INSERT INTO identity.users (display_name, email) VALUES ('a', 'x')"), "23514");
    });

    it("does not make email unique: identities, not emails, identify people", async () => {
      await user("a", "same@example.com");
      await expect(user("b", "same@example.com")).resolves.toBeTruthy();
    });
  });

  describe("identity.auth_identities", () => {
    it("is unique on (provider, subject) and on (user, provider), and refuses an unknown provider", async () => {
      const a = await user();
      const b = await user();
      await admin.query("INSERT INTO identity.auth_identities (user_id, provider, provider_subject) VALUES ($1, 'google', 'sub-1')", [a]);
      await rejects(
        admin.query("INSERT INTO identity.auth_identities (user_id, provider, provider_subject) VALUES ($1, 'google', 'sub-1')", [b]),
        "23505",
      );
      await rejects(
        admin.query("INSERT INTO identity.auth_identities (user_id, provider, provider_subject) VALUES ($1, 'google', 'sub-2')", [a]),
        "23505",
      );
      await rejects(
        admin.query("INSERT INTO identity.auth_identities (user_id, provider, provider_subject) VALUES ($1, 'facebook', 'x')", [b]),
        "23514",
      );
      // The same subject under another provider is a different identity.
      await expect(
        admin.query("INSERT INTO identity.auth_identities (user_id, provider, provider_subject) VALUES ($1, 'local', 'sub-1')", [b]),
      ).resolves.toBeTruthy();
    });

    it("needs an existing user (23503) and disappears with it", async () => {
      await rejects(
        admin.query("INSERT INTO identity.auth_identities (user_id, provider, provider_subject) VALUES (gen_random_uuid(), 'google', 'ghost')"),
        "23503",
      );
      const u = await user();
      await admin.query("INSERT INTO identity.auth_identities (user_id, provider, provider_subject) VALUES ($1, 'google', 'to-delete')", [u]);
      await admin.query("DELETE FROM identity.users WHERE id = $1", [u]);
      expect((await admin.query("SELECT 1 FROM identity.auth_identities WHERE provider_subject = 'to-delete'")).rows).toEqual([]);
    });
  });

  describe("identity.sessions", () => {
    it("stores a 32-byte hash key, expires after it was created, and cascades with the user", async () => {
      const u = await user();
      await rejects(
        admin.query("INSERT INTO identity.sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [Buffer.alloc(16), u]),
        "23514",
      );
      await rejects(
        admin.query("INSERT INTO identity.sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() - interval '1 hour')", [HASH(1), u]),
        "23514",
      );
      await admin.query("INSERT INTO identity.sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [HASH(1), u]);
      await rejects(
        admin.query("INSERT INTO identity.sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [HASH(1), u]),
        "23505",
      );
      await admin.query("DELETE FROM identity.users WHERE id = $1", [u]);
      expect((await admin.query("SELECT 1 FROM identity.sessions WHERE id_hash = $1", [HASH(1)])).rows).toEqual([]);
    });
  });

  describe("identity.login_attempts", () => {
    const insert = (returnPath: string, overrides: { state?: string; verifier?: string; idHash?: Buffer } = {}) =>
      admin.query(
        "INSERT INTO identity.login_attempts (id_hash, state, nonce, code_verifier, return_path, expires_at) VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')",
        [overrides.idHash ?? Buffer.alloc(32, Math.floor(Math.random() * 250) + 1), overrides.state ?? LONG("s", 32), LONG("n", 32), overrides.verifier ?? LONG("v", 43), returnPath],
      );

    it.each(["/app", "/app/", "/app/servers/abc", "/app?tab=power", "/app#x", "/app/a/b?c=d&e=f"])("accepts the relative path %s", async (path) => {
      await expect(insert(path)).resolves.toBeTruthy();
    });

    it.each([
      "//evil.example",
      "/app/../..//evil",
      "https://evil.example/app",
      "/application",
      "/apple",
      "app",
      "",
      "/app\\evil",
      "/app/\nx",
      "/other",
      "\\\\evil",
    ])("refuses the return path %j (an open redirect) with a check violation", async (path) => {
      await rejects(insert(path), "23514");
    });

    it("refuses short state or verifier values and a wrong-length id hash", async () => {
      await rejects(insert("/app", { state: "short" }), "23514");
      await rejects(insert("/app", { verifier: "tooshort" }), "23514");
      await rejects(insert("/app", { idHash: Buffer.alloc(8) }), "23514");
    });
  });

  describe("servers.servers", () => {
    it("has a unique public id matching the shared ServerIdSchema", async () => {
      await server("alpha-1");
      await rejects(admin.query("INSERT INTO servers.servers (public_id, display_name) VALUES ('alpha-1', 'X')"), "23505");
      for (const bad of ["Alpha", "has space", "a".repeat(33), "", "under_score", "dot.ted"]) {
        await rejects(admin.query("INSERT INTO servers.servers (public_id, display_name) VALUES ($1, 'X')", [bad]), "23514");
      }
      await rejects(admin.query("INSERT INTO servers.servers (public_id, display_name, hosting_mode) VALUES ('m1', 'X', 'cloud')"), "23514");
      await rejects(admin.query("INSERT INTO servers.servers (public_id, display_name) VALUES ('nn', '')"), "23514");
    });
  });

  describe("servers.server_members", () => {
    it("allows at most one owner per server, by the partial unique index (23505)", async () => {
      const s = await server("owned-1");
      const [a, b, c] = [await user(), await user(), await user()];
      await admin.query("INSERT INTO servers.server_members (server_id, user_id, role) VALUES ($1, $2, 'owner')", [s, a]);
      await rejects(
        admin.query("INSERT INTO servers.server_members (server_id, user_id, role) VALUES ($1, $2, 'owner')", [s, b]),
        "23505",
        "server_members_one_owner",
      );
      // Many admins and viewers are fine, and another server may have its own owner.
      await admin.query("INSERT INTO servers.server_members (server_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'viewer')", [s, b, c]);
      const s2 = await server("owned-2");
      await admin.query("INSERT INTO servers.server_members (server_id, user_id, role) VALUES ($1, $2, 'owner')", [s2, b]);
      // Promoting a second member to owner is refused too (the update path).
      await rejects(admin.query("UPDATE servers.server_members SET role = 'owner' WHERE server_id = $1 AND user_id = $2", [s, b]), "23505", "server_members_one_owner");
    });

    it("is one row per (server, user), needs both to exist, and refuses an unknown role", async () => {
      const s = await server("members-1");
      const u = await user();
      await admin.query("INSERT INTO servers.server_members (server_id, user_id, role) VALUES ($1, $2, 'viewer')", [s, u]);
      await rejects(admin.query("INSERT INTO servers.server_members (server_id, user_id, role) VALUES ($1, $2, 'admin')", [s, u]), "23505", "server_members_pkey");
      await rejects(admin.query("INSERT INTO servers.server_members (server_id, user_id, role) VALUES (gen_random_uuid(), $1, 'viewer')", [u]), "23503");
      await rejects(admin.query("INSERT INTO servers.server_members (server_id, user_id, role) VALUES ($1, gen_random_uuid(), 'viewer')", [s]), "23503");
      const other = await user();
      await rejects(admin.query("INSERT INTO servers.server_members (server_id, user_id, role) VALUES ($1, $2, 'root')", [s, other]), "23514");
    });

    it("cascades when the server or the user is deleted", async () => {
      const s = await server("cascade-1");
      const u = await user();
      await admin.query("INSERT INTO servers.server_members (server_id, user_id, role) VALUES ($1, $2, 'owner')", [s, u]);
      await admin.query("DELETE FROM identity.users WHERE id = $1", [u]);
      expect((await admin.query("SELECT 1 FROM servers.server_members WHERE server_id = $1", [s])).rows).toEqual([]);
    });
  });

  describe("audit.audit_events", () => {
    it("takes a well-formed action and an object detail, and refuses anything else", async () => {
      await admin.query("INSERT INTO audit.audit_events (action, detail) VALUES ('login', '{\"ok\":true}')");
      for (const bad of ["Login", "1login", "a", "has space", "x".repeat(70)]) {
        await rejects(admin.query("INSERT INTO audit.audit_events (action) VALUES ($1)", [bad]), "23514");
      }
      await rejects(admin.query("INSERT INTO audit.audit_events (action, detail) VALUES ('login', '[1,2]')"), "23514");
      await rejects(admin.query("INSERT INTO audit.audit_events (action, detail) VALUES ('login', '\"str\"')"), "23514");
    });

    it("keeps a row after the user it names is deleted (no foreign keys)", async () => {
      const u = await user();
      await admin.query("INSERT INTO audit.audit_events (action, actor_user_id) VALUES ('grant_owner', $1)", [u]);
      await admin.query("DELETE FROM identity.users WHERE id = $1", [u]);
      expect((await admin.query("SELECT 1 FROM audit.audit_events WHERE actor_user_id = $1", [u])).rows).toHaveLength(1);
    });
  });

  describe("what satis_app may do", () => {
    it("has DML on the module tables and can use the identity sequence", async () => {
      await app.query("INSERT INTO identity.users (display_name) VALUES ('app-made')");
      await app.query("UPDATE identity.users SET display_name = 'renamed' WHERE display_name = 'app-made'");
      await app.query("DELETE FROM identity.users WHERE display_name = 'renamed'");
      await app.query("INSERT INTO audit.audit_events (action) VALUES ('via_app')");
    });

    it("can insert and read, but never update or delete, the audit trail", async () => {
      await app.query("INSERT INTO audit.audit_events (action) VALUES ('append_only')");
      expect((await app.query("SELECT count(*)::int AS n FROM audit.audit_events WHERE action = 'append_only'")).rows[0].n).toBe(1);
      await rejects(app.query("UPDATE audit.audit_events SET action = 'tampered' WHERE action = 'append_only'"), "42501");
      await rejects(app.query("DELETE FROM audit.audit_events WHERE action = 'append_only'"), "42501");
      await rejects(app.query("TRUNCATE audit.audit_events"), "42501");
    });

    it("cannot change the schema", async () => {
      await rejects(app.query("ALTER TABLE identity.users ADD COLUMN evil text"), "42501");
      await rejects(app.query("DROP TABLE servers.servers CASCADE"), "42501");
      await rejects(app.query("CREATE INDEX evil ON identity.users (display_name)"), "42501");
      await rejects(app.query("TRUNCATE identity.users CASCADE"), "42501");
    });
  });
});
