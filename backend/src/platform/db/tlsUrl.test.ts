import { createSecureContext } from "node:tls";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "./config.js";

// Issue #406 (ADR-0034): on AWS the backend reaches RDS with
//   DATABASE_URL=postgres://...?sslmode=verify-full&sslrootcert=/etc/ssl/rds/global-bundle.pem
// (the bundle both images carry, backend/Dockerfile). These tests prove that URL becomes a TLS
// config that verifies the server's certificate chain against that CA and its host name, without a
// live RDS: they read the options pg builds from the URL, the same parse a pool's clients go through.

const BUNDLE = fileURLToPath(new URL("../../../rds-global-bundle.pem", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "satis-tls-url-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface ParsedSsl {
  ca?: string;
  rejectUnauthorized?: boolean;
  checkServerIdentity?: unknown;
}

/** The TLS options pg derives from DATABASE_URL, after the backend's own validation. */
function sslOf(databaseUrl: string): ParsedSsl | boolean {
  const config = loadDatabaseConfig({ DATABASE_URL: databaseUrl });
  if (config === undefined) throw new Error("expected a database config");
  const client = new pg.Client({ connectionString: config.url });
  return (client as unknown as { connectionParameters: { ssl: ParsedSsl | boolean } }).connectionParameters.ssl;
}

function rdsUrl(query: string): string {
  return `postgres://satis_app:s3cret-pass@satis.abc123.eu-west-1.rds.amazonaws.com:5432/satis?${query}`;
}

describe("DATABASE_URL with sslmode=verify-full&sslrootcert (issue #406)", () => {
  it("becomes a verifying TLS config whose CA is the sslrootcert file", () => {
    const ssl = sslOf(rdsUrl(`sslmode=verify-full&sslrootcert=${encodeURIComponent(BUNDLE)}`));
    expect(typeof ssl).toBe("object");
    const tls = ssl as ParsedSsl;
    expect(tls.ca).toBe(readFileSync(BUNDLE, "utf8"));
    // Node's tls.connect verifies the chain unless rejectUnauthorized is false, and the host name
    // unless checkServerIdentity is overridden: neither may be switched off.
    expect(tls.rejectUnauthorized).not.toBe(false);
    expect(tls.checkServerIdentity).toBeUndefined();
  });

  it("uses the RDS bundle the images carry, which is a loadable CA", () => {
    const pem = readFileSync(BUNDLE, "utf8");
    expect(pem.match(/-----BEGIN CERTIFICATE-----/g)?.length ?? 0).toBeGreaterThan(1);
    expect(() => createSecureContext({ ca: pem })).not.toThrow();
  });

  it("edge: takes the CA from any sslrootcert path, not only the bundle", () => {
    const ca = join(scratch, "other-ca.pem");
    writeFileSync(ca, readFileSync(BUNDLE, "utf8").split("-----END CERTIFICATE-----")[0] + "-----END CERTIFICATE-----\n");
    const tls = sslOf(rdsUrl(`sslmode=verify-full&sslrootcert=${encodeURIComponent(ca)}`)) as ParsedSsl;
    expect(tls.ca).toBe(readFileSync(ca, "utf8"));
    expect(tls.rejectUnauthorized).not.toBe(false);
  });

  it("edge: a missing sslrootcert file fails loudly instead of connecting without the CA", () => {
    const missing = join(scratch, "does-not-exist.pem");
    expect(() => sslOf(rdsUrl(`sslmode=verify-full&sslrootcert=${encodeURIComponent(missing)}`))).toThrow(/ENOENT/);
  });

  it("edge: sslmode=no-verify is the one mode that turns verification off (so compose never uses it)", () => {
    const tls = sslOf(rdsUrl("sslmode=no-verify")) as ParsedSsl;
    expect(tls.rejectUnauthorized).toBe(false);
  });

  it("edge: a URL with no sslmode (the compose stack's local postgres) asks for no TLS", () => {
    expect(sslOf("postgres://satis_app:s3cret-pass@postgres:5432/satis")).toBe(false);
  });
});
