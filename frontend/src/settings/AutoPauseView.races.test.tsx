import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
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

/** A promise the test opens itself (tsconfig's ES2023 lib has no Promise.withResolvers). */
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

// Release any gate a failed test left closed, so no handler stays pending into the next test.
let gates: { resolve: () => void }[] = [];
afterEach(() => {
  for (const gate of gates) gate.resolve();
  gates = [];
});

describe("AutoPauseView ordering", () => {
  it("keeps the PUT's value when a settings read that started during the PUT resolves after it", async () => {
    // e.g. a window-focus refetch or a pending-change poll tick while the PUT is in flight.
    // That read may have been answered before the server applied the change, so it must not
    // replace the value the PUT re-read after applying.
    // Explicit gates, not wall-clock delays: the test decides when each response is sent, so
    // the late read always starts while the PUT is in flight and resolves after it.
    const putGate = gate();
    const lateReadGate = gate();
    const lateReadAnswered = gate();
    gates = [putGate, lateReadGate];
    let reads = 0;
    let putStarted = false;
    server.use(
      http.get(endpoints.settings.get.route, async () => {
        reads++;
        if (reads > 1) {
          await lateReadGate.promise;
          lateReadAnswered.resolve();
        }
        return HttpResponse.json(settingsEditable);
      }),
      http.put(endpoints.settings.setAutoPause.route, async () => {
        putStarted = true;
        await putGate.promise;
        return HttpResponse.json(autoPauseOn);
      }),
    );
    const { client } = renderView();
    await screen.findByRole("checkbox");

    fireEvent.click(checkbox());
    await waitFor(() => expect(putStarted).toBe(true));
    const lateRead = client.refetchQueries({ queryKey: queries.settings("default").queryKey });
    await waitFor(() => expect(reads).toBe(2));

    // The PUT answers first, while the late read is still held.
    putGate.resolve();
    await waitFor(() => expect(checkbox()).toBeChecked());

    // Then the late read answers with the pre-change value. Wait until its handler has replied
    // and the refetch has settled (with the stale value applied, if the view let it through).
    lateReadGate.resolve();
    await lateReadAnswered.promise;
    await lateRead;
    expect(client.getQueryData(queries.settings("default").queryKey)?.data.autoPause).toBe(true);
    // TanStack Query hands cache updates to React on a zero-delay timer, queued before this one,
    // so after it the screen shows whatever the cache settled on.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(checkbox()).toBeChecked();
  });
});
