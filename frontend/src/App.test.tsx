import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { serversSingle, statusPaused } from "@satisfactory-dash/shared/fixtures";
import App from "./App";
import { renderWithClient } from "./test/render";
import { server } from "./test/server";

describe("App", () => {
  it("signs in, selects the only server and shows its status banners", async () => {
    server.use(http.get(endpoints.status.route, () => HttpResponse.json(statusPaused)));
    renderWithClient(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Satis Manager");
    expect(
      await screen.findByRole("heading", { level: 2, name: serversSingle.servers[0].displayName }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Paused: no players connected/)).toBeInTheDocument();
  });
});
