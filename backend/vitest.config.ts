import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ADR-0025: one Postgres container per run for the database tests (skipped locally without
    // Docker with a loud notice; in CI a missing Docker fails the run).
    globalSetup: ["./test-support/dbGlobalSetup.ts"],
    // Issue #270: every pg Pool/Client a test creates gets an `error` listener, so a teardown that terminates connections
    // (DROP DATABASE ... FORCE, stopping the container) is not an unhandled error.
    setupFiles: ["./test-support/pgIdleErrors.ts"],
    // Starting the container (and pulling the image the first time) happens in globalSetup.
    hookTimeout: 120_000,
  },
});
