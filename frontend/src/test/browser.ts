import { delay, http, HttpResponse } from "msw";
import { setupWorker } from "msw/browser";
import { isScenario, responsesFor, ROUTES, type MockResponse, type RouteKey } from "./scenarios";

// Dev mock mode (`npm run dev:mock`): serves the shared fixtures in the browser so every UI
// state can be opened and reviewed without a backend. Pick one with ?scenario=<name>
// (see scenarios.ts). Only main.tsx loads this, and only when Vite's mode is "mock", so it
// never reaches a production build.

function respond(response: MockResponse) {
  return async () => {
    if (response.delay === "never") await new Promise(() => {});
    if (typeof response.delay === "number") await delay(response.delay);
    if (response.text !== undefined) return new HttpResponse(response.text, { status: response.status });
    return HttpResponse.json(response.body as object, { status: response.status });
  };
}

export async function startMockApi(search: string): Promise<void> {
  const requested = new URLSearchParams(search).get("scenario") ?? "default";
  const scenario = isScenario(requested) ? requested : "default";
  const responses = responsesFor(scenario);
  const handlers = (Object.keys(ROUTES) as RouteKey[]).map((key) => {
    const { method, route } = ROUTES[key];
    // Every method its own handler: PATCH and DELETE used to fall through to POST and never match.
    const verb = { GET: http.get, POST: http.post, PUT: http.put, PATCH: http.patch, DELETE: http.delete }[method];
    return verb(route, respond(responses[key]));
  });
  await setupWorker(...handlers).start({ onUnhandledRequest: "bypass", quiet: true });
  console.info(`[mock api] scenario "${scenario}"`);
}
