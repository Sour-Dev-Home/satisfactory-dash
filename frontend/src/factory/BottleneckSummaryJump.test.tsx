import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { BrowserRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { bottlenecksEmpty, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { FactoryView } from "./FactoryView";

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

function renderPage() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <BrowserRouter>
        <FactoryView />
      </BrowserRouter>
    </ServerContext>,
  );
}

describe("bottleneck summary link on the Factory page", () => {
  it("jumps again when clicked a second time after the user moved away", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.history.pushState(null, "", "/app/factory");
    renderPage();
    const link = await screen.findByRole("link", { name: "Full list of bottlenecks" });
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Bottlenecks" })).toHaveFocus());
    expect(scroll).toHaveBeenCalledTimes(1);
    // The user scrolls back up and clicks the same link again.
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(screen.getByRole("link", { name: "Full list of bottlenecks" }));
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
  });

  it("shows no link and the calm line on the page when there are no bottlenecks", async () => {
    server.use(http.get(endpoints.bottlenecks.route, () => HttpResponse.json(bottlenecksEmpty)));
    window.history.pushState(null, "", "/app/factory");
    renderPage();
    expect(await screen.findByRole("heading", { name: "No bottlenecks", level: 3, description: undefined })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Full list of bottlenecks" })).not.toBeInTheDocument();
  });
});
