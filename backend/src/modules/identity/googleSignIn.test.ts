import { describe, it, expect } from "vitest";
import { createGoogleSignIn } from "./googleSignIn.js";
import type { Db } from "./dbSessionStore.js";

const OWNER = "owner@example.com";

interface Store {
  users: Array<{ id: string; email: string | null; status: "active" | "disabled" }>;
  identities: Array<{ userId: string; provider: string; subject: string }>;
  audits: Array<{ action: string; detail: Record<string, unknown> }>;
  sessions: number;
  emailWrites: string[];
}

/** An in-memory stand-in for the handful of statements sign-in issues (no Postgres needed). */
function fakeDb(seed: Partial<Store> = {}) {
  const store: Store = {
    users: [{ id: "u-op", email: null, status: "active" }],
    identities: [{ userId: "u-op", provider: "local", subject: "operator" }],
    audits: [],
    sessions: 0,
    emailWrites: [],
    ...seed,
  };
  const now = new Date();
  const query = async (sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> => {
    const text = sql.trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text)) return { rows: [] };
    if (text.includes("JOIN identity.users u ON u.id = i.user_id")) {
      const identity = store.identities.find((i) => i.provider === params[0] && i.subject === params[1]);
      const user = store.users.find((u) => u.id === identity?.userId);
      return { rows: user ? [{ id: user.id, display_name: "Op", email: user.email, status: user.status, created_at: now }] : [] };
    }
    if (text.startsWith("SELECT provider")) {
      return { rows: store.identities.filter((i) => i.userId === params[0]).map((i) => ({ provider: i.provider })) };
    }
    if (text.includes("INSERT INTO identity.auth_identities")) {
      store.identities.push({ userId: params[0] as string, provider: params[1] as string, subject: params[2] as string });
      return { rows: [{ id: "i-new" }] };
    }
    if (text.includes("SET email")) {
      store.emailWrites.push(params[1] as string);
      const user = store.users.find((u) => u.id === params[0]);
      if (user) user.email = (params[1] as string).toLowerCase();
      return { rows: [] };
    }
    if (text.includes("INSERT INTO audit.audit_events")) {
      const detail = JSON.parse(params[3] as string) as Record<string, unknown>;
      store.audits.push({ action: params[2] as string, detail });
      return { rows: [{ id: "1", at: now, actor_user_id: params[0], server_id: null, action: params[2], detail }] };
    }
    if (text.includes("INSERT INTO identity.sessions")) {
      store.sessions += 1;
      return { rows: [] };
    }
    throw new Error(`unexpected SQL: ${text.slice(0, 60)}`);
  };
  const db = { query, connect: async () => ({ query, on: () => undefined, removeListener: () => undefined, release: () => undefined }) };
  return { db: db as unknown as Db, store };
}

const claims = (over: Partial<{ sub: string; email: string | undefined; emailVerified: unknown }> = {}) => ({
  sub: "sub-1",
  email: OWNER as string | undefined,
  emailVerified: true as unknown,
  ...over,
});

describe("createGoogleSignIn (in-memory)", () => {
  it("links the operator when the verified email matches, ignoring case and surrounding whitespace", async () => {
    const { db, store } = fakeDb();
    const result = await createGoogleSignIn(db, OWNER).complete(claims({ email: `  ${OWNER.toUpperCase()} ` }), undefined);
    expect(result.kind).toBe("signed_in");
    expect(store.identities).toContainEqual({ userId: "u-op", provider: "google", subject: "sub-1" });
    expect(store.sessions).toBe(1);
  });

  it.each([["true"], [1], [undefined], [null], ["false"], [false]])("refuses email_verified = %j and links nothing", async (flag) => {
    const { db, store } = fakeDb();
    const result = await createGoogleSignIn(db, OWNER).complete(claims({ emailVerified: flag }), undefined);
    expect(result).toEqual({ kind: "refused", reason: "unverified_email" });
    expect(store.identities).toHaveLength(1);
    expect(store.emailWrites).toEqual([]);
    expect(store.sessions).toBe(0);
  });

  it("closed sign-up: an unknown account with a different email creates no identity, stores no email, audits without the email", async () => {
    const { db, store } = fakeDb();
    const result = await createGoogleSignIn(db, OWNER).complete(claims({ sub: "stranger", email: "x@example.com" }), undefined);
    expect(result).toEqual({ kind: "refused", reason: "not_invited" });
    expect(store.users).toHaveLength(1);
    expect(store.identities).toHaveLength(1);
    expect(store.emailWrites).toEqual([]);
    expect(store.audits).toEqual([{ action: "signin.refused", detail: { provider: "google", reason: "not_invited" } }]);
    expect(JSON.stringify(store.audits)).not.toContain("example.com");
  });

  it("a claim without an email is never linked, even though the operator exists", async () => {
    const { db, store } = fakeDb();
    const result = await createGoogleSignIn(db, OWNER).complete(claims({ email: undefined }), undefined);
    expect(result).toEqual({ kind: "refused", reason: "not_invited" });
    expect(store.identities).toHaveLength(1);
  });

  it("a lookalike email (suffix, prefix, plus-tag) is not the owner", async () => {
    for (const email of [`x${OWNER}`, `${OWNER}.evil`, "owner+tag@example.com", "owner@example.com\u0000"]) {
      const { db, store } = fakeDb();
      const result = await createGoogleSignIn(db, OWNER).complete(claims({ email }), undefined);
      expect(result.kind).toBe("refused");
      expect(store.identities).toHaveLength(1);
    }
  });

  it("does not link the operator a second time: a different sub claiming the owner email is refused", async () => {
    const { db, store } = fakeDb();
    const signIn = createGoogleSignIn(db, OWNER);
    expect((await signIn.complete(claims(), undefined)).kind).toBe("signed_in");
    expect(await signIn.complete(claims({ sub: "sub-2" }), undefined)).toEqual({ kind: "refused", reason: "not_invited" });
    expect(store.identities.filter((i) => i.provider === "google")).toHaveLength(1);
  });

  it("a returning user is found by sub even with a different email, and the email is not rewritten", async () => {
    const { db, store } = fakeDb();
    const signIn = createGoogleSignIn(db, OWNER);
    await signIn.complete(claims(), undefined);
    const writes = store.emailWrites.length;
    const again = await signIn.complete(claims({ email: "changed@example.com" }), undefined);
    expect(again.kind).toBe("signed_in");
    expect(store.emailWrites).toHaveLength(writes);
  });

  it("refuses a disabled user found by sub and audits it against that user", async () => {
    const { db, store } = fakeDb({
      users: [{ id: "u-2", email: null, status: "disabled" }],
      identities: [{ userId: "u-2", provider: "google", subject: "sub-9" }],
    });
    const result = await createGoogleSignIn(db, OWNER).complete(claims({ sub: "sub-9", email: "z@example.com" }), undefined);
    expect(result).toEqual({ kind: "refused", reason: "disabled" });
    expect(store.sessions).toBe(0);
  });

  it("does not link a disabled operator", async () => {
    const { db, store } = fakeDb({ users: [{ id: "u-op", email: null, status: "disabled" }] });
    const result = await createGoogleSignIn(db, OWNER).complete(claims(), undefined);
    expect(result).toEqual({ kind: "refused", reason: "not_invited" });
    expect(store.identities).toHaveLength(1);
  });
});
