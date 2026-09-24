import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ADR-0025: one Postgres container per run for the database tests (skipped locally without
    // Docker with a loud notice; in CI a missing Docker fails the run).
    globalSetup: ["./test-support/dbGlobalSetup.ts"],
    // Starting the container (and pulling the image the first time) happens in globalSetup.
    hookTimeout: 120_000,
  },
});
