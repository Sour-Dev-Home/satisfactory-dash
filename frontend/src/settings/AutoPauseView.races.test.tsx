import { fireEvent, screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type SettingsResponse } from "@satisfactory-dash/shared";
import { serversSingle, settingsEditable } from "@satisfactory-dash/shared/fixtures";
import { queries } from "../api/queries";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AutoPauseView } from "./AutoPauseView";

// Fresh-eyes pass: ordering races around the one write the dashboard makes to the game server.

const autoPauseOn = {
  ...settingsEditable,
  data: { ...settingsEditable.data, autoPause: true },
} satisfies SettingsResponse;

const checkbox = () => screen.getByRole("checkbox", { name: /Auto-pause when no players are connected/ });

function renderView() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <AutoPauseView />
    </ServerContext>,
  );
}

describe("AutoPauseView ordering", () => {
  it("keeps the PUT's value when a settings read that started during the PUT resolves after it", async () => {
    // e.g. a window-focus refetch or a pending-change poll tick while the PUT is in flight.
    // That read may have been answered before the server applied the change, so it must not
    // replace the value the PUT re-read after applying.
    let reads = 0;
    let putStarted = false;
    server.use(
      http.get(endpoints.settings.get.route, async () => {
        reads++;
        if (reads > 1) await delay(120);
        return HttpResponse.json(settingsEditable);
      }),
      http.put(endpoints.settings.setAutoPause.route, async () => {
        putStarted = true;
        await delay(40);
        return HttpResponse.json(autoPauseOn);
      }),
    );
    const { client } = renderView();
    await screen.findByRole("checkbox");

    fireEvent.click(checkbox());
    await waitFor(() => expect(putStarted).toBe(true));
    void client.refetchQueries({ queryKey: queries.settings("default").queryKey });
    await waitFor(() => expect(reads).toBe(2));

    await waitFor(() => expect(checkbox()).toBeChecked());
    await delay(160);
    expect(checkbox()).toBeChecked();
  });
});
