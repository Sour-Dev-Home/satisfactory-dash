import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./test/server";

// A request with no handler fails the test instead of silently hitting the network.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// The app routes by URL (ADR-0016 item 4), and jsdom keeps one URL per test file, so start
// every test at / like a fresh page load. A test that needs a page navigates first.
afterEach(() => window.history.replaceState(null, "", "/"));
