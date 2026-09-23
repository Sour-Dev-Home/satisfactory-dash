import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { errorUnknownCode } from "@satisfactory-dash/shared/fixtures";
import App from "./App";
import { renderWithClient } from "./test/render";
import { server } from "./test/server";

describe("App", () => {
  it("renders the backend status once the health check resolves", async () => {
    renderWithClient(<App />);
    expect(await screen.findByText(/status: ok/i)).toBeInTheDocument();
  });

  it("says the backend is unreachable when the health check fails", async () => {
    server.use(http.get(endpoints.health.route, () => HttpResponse.json(errorUnknownCode, { status: 500 })));
    renderWithClient(<App />);
    expect(await screen.findByText(/could not reach backend/i)).toBeInTheDocument();
  });
});
