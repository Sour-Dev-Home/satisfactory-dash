import type { Pool, PoolClient } from "pg";

/**
 * ADR-0025 decision 2: one transaction helper. BEGIN, run `fn` on one client, COMMIT; on any
 * error ROLLBACK and rethrow the original error; always release the client. The default READ
 * COMMITTED isolation is enough because the invariants live in constraints and single statements
 * (guarded DELETE/UPDATE ... RETURNING, ON CONFLICT ... WHERE, partial unique indexes): no
 * SERIALIZABLE and no retry loops.
 */
export async function withTransaction<T>(pool: Pick<Pool, "connect">, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  // pg-pool removes its own 'error' listener while a client is checked out, so a connection
  // that dies between statements (the server restarting, pg_terminate_backend) would be an
  // uncaught 'error' event and crash the whole backend. The failure still reaches the caller
  // through the next query, and a client that errored is destroyed rather than reused.
  let broken = false;
  const onError = () => {
    broken = true;
  };
  client.on("error", onError);
  let destroy = false;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is unusable (e.g. lost mid-transaction): don't return it to the pool.
      destroy = true;
    }
    throw err;
  } finally {
    client.removeListener("error", onError);
    client.release(destroy || broken);
  }
}
