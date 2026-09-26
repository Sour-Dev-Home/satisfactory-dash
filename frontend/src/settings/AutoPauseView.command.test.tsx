import { useState } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type Command } from "@satisfactory-dash/shared";
import {
  autoPauseResponseAccepted,
  commandExpired,
  commandFailed,
  commandPending,
  errorCommandNotFound,
  serversMultiple,
  serversSingle,
  settingsEditable,
} from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { AutoPauseView } from "./AutoPauseView";
import { EXPIRED_TEXT, EXPIRY_GRACE_MS, failureText } from "./command";

// ADR-0031 PR 4: a change relayed through the game PC's agent. The PUT answers 202 with a command,
// and the page follows it (GET /commands/:id, about once a second) to its result.

/** A fixture command whose expiry is `ms` from now (the fixtures' fixed times are in the past). */
const expiringIn = (c: { command: Command }, ms: number, patch: Partial<Command> = {}) => ({
  command: { ...c.command, ...patch, expiresAt: new Date(Date.now() + ms).toISOString() },
});

function relay(answers: (poll: number) => Record<string, unknown> | Response, expiresInMs = 600_000) {
  let polls = 0;
  let reads = 0;
  server.use(
    http.get(endpoints.settings.get.route, () => {
      reads += 1;
      return HttpResponse.json(settingsEditable);
    }),
    http.put(endpoints.settings.setAutoPause.route, () =>
      HttpResponse.json(expiringIn(autoPauseResponseAccepted, expiresInMs), { status: 202 }),
    ),
    http.get(endpoints.commands.get.route, () => {
      polls += 1;
      const answer = answers(polls);
      return answer instanceof Response ? answer : HttpResponse.json(answer);
    }),
  );
  return { polls: () => polls, reads: () => reads };
}

function renderView() {
  return renderWithClient(
    <ServerContext value={serversSingle.servers[0]}>
      <AutoPauseView />
    </ServerContext>,
  );
}

const checkbox = () => screen.getByRole("checkbox", { name: /Auto-pause when no players are connected/ });

async function toggle() {
  renderView();
  await screen.findByRole("checkbox");
  fireEvent.click(checkbox());
}

describe("AutoPauseView, a change relayed through the agent", () => {
  it("says why a failed command didn't change anything, by its result code, and frees the toggle", async () => {
    relay((poll) => (poll < 2 ? expiringIn(commandPending, 600_000) : expiringIn(commandFailed, 600_000)));
    await toggle();
    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(failureText("upstream_unreachable"));
    expect(failureText("upstream_unreachable")).toMatch(/couldn't reach the game server/);
    expect(checkbox()).toBeEnabled();
    expect(checkbox()).not.toBeChecked();
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
  });

  it("gives an unknown result code a general line", async () => {
    relay(() => expiringIn(commandFailed, 600_000, { resultCode: "disk_on_fire" }));
    await toggle();
    expect(await screen.findByRole("alert")).toHaveTextContent("The change failed on the game PC; the setting didn't change.");
  });

  it("says the game PC didn't answer in time when the backend reports the command expired", async () => {
    relay(() => expiringIn(commandExpired, 600_000));
    await toggle();
    expect(await screen.findByRole("alert")).toHaveTextContent(EXPIRED_TEXT);
    expect(checkbox()).toBeEnabled();
  });

  it("stops polling once the command is final", async () => {
    const calls = relay(() => expiringIn(commandFailed, 600_000));
    await toggle();
    await screen.findByRole("alert");
    const settled = calls.polls();
    await new Promise((r) => setTimeout(r, 2500));
    expect(calls.polls()).toBe(settled);
  });

  it("treats a status this build doesn't know as still on its way, and keeps polling", async () => {
    const calls = relay(() => expiringIn(commandPending, 600_000, { status: "queued_at_agent" }));
    await toggle();
    await waitFor(() => expect(calls.polls()).toBeGreaterThanOrEqual(2), { timeout: 4000 });
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(checkbox()).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("gives up just after the command's expiry when no final status arrives, and re-reads the setting", async () => {
    // Expired a moment ago, so the page's grace period is the only wait left.
    const calls = relay(() => expiringIn(commandPending, 0), -EXPIRY_GRACE_MS + 300);
    await toggle();
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent(EXPIRED_TEXT);
    await waitFor(() => expect(calls.reads()).toBe(2));
    expect(checkbox()).toBeEnabled();
  });

  it("holds the toggle while the change is on its way: a second click sends nothing", async () => {
    let puts = 0;
    relay(() => expiringIn(commandPending, 600_000));
    server.use(
      http.put(endpoints.settings.setAutoPause.route, () => {
        puts += 1;
        return HttpResponse.json(expiringIn(autoPauseResponseAccepted, 600_000), { status: 202 });
      }),
    );
    await toggle();
    await screen.findByText("Saving…");
    fireEvent.click(checkbox());
    expect(puts).toBe(1);
  });

  it("clears the last outcome when the next change starts", async () => {
    let round = 0;
    relay(() => (round === 1 ? expiringIn(commandFailed, 600_000) : expiringIn(commandPending, 600_000)));
    round = 1;
    await toggle();
    await screen.findByRole("alert");
    round = 2;
    fireEvent.click(checkbox());
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("shows an error if the command can't be found, rather than spinning forever", async () => {
    relay(() => HttpResponse.json(errorCommandNotFound, { status: 404 }), 1_000 - EXPIRY_GRACE_MS);
    await toggle();
    // No answer ever arrives, so it ends like an expiry: the setting is re-read and the toggle freed.
    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(EXPIRED_TEXT);
    expect(checkbox()).toBeEnabled();
  });

  // Found by the test-hunter: switching servers mid-command leaked server A's command onto server B
  // (B's toggle stuck on "Saving…", and A's command id polled on B's route). The view now ignores a
  // command sent to another server, even without the key Shell.tsx also gives it.
  it("drops the followed command when the selected server changes, instead of leaking it onto the new server", async () => {
    let commandPollsForB = 0;
    server.use(
      http.get(endpoints.settings.get.route, () => HttpResponse.json(settingsEditable)),
      http.put(endpoints.settings.setAutoPause.route, () =>
        HttpResponse.json(expiringIn(autoPauseResponseAccepted, 600_000), { status: 202 }),
      ),
      http.get(endpoints.commands.get.route, ({ params }) => {
        if (params.serverId === "creative-test") commandPollsForB += 1;
        // Never resolves within the test, so server A's command stays "waiting" forever.
        return HttpResponse.json(expiringIn(commandPending, 600_000));
      }),
    );

    function Switcher() {
      const [selected, setSelected] = useState(serversMultiple.servers[0]);
      return (
        <>
          <button onClick={() => setSelected(serversMultiple.servers[1])}>switch server</button>
          <ServerContext value={selected}>
            <AutoPauseView />
          </ServerContext>
        </>
      );
    }
    renderWithClient(<Switcher />);
    await screen.findByRole("checkbox");
    fireEvent.click(checkbox());
    await screen.findByText("Saving…");

    fireEvent.click(screen.getByRole("button", { name: "switch server" }));

    // Server B (creative-test) has no change of its own in flight: its toggle should be usable,
    // and its /commands/:id route should never be hit for A's command id.
    await waitFor(() => expect(checkbox()).toBeEnabled());
    expect(commandPollsForB).toBe(0);
  });

  // A real bug in the fix above: onChange's guard checks the raw `sent` state, not the
  // server-filtered `relayed`. Starting a change on server B (which has nothing shown, since
  // `relayed` is already null there) still nulls out `sent`, destroying server A's still-unresolved
  // command tracking. Switching back to A then shows it as idle, even though its command never
  // actually resolved.
  it("does not let starting a change on server B erase server A's still-pending command", async () => {
    server.use(
      http.get(endpoints.settings.get.route, () => HttpResponse.json(settingsEditable)),
      http.put(endpoints.settings.setAutoPause.route, () =>
        HttpResponse.json(expiringIn(autoPauseResponseAccepted, 600_000), { status: 202 }),
      ),
      http.get(endpoints.commands.get.route, () =>
        // Never resolves within the test: server A's command stays "waiting" forever.
        HttpResponse.json(expiringIn(commandPending, 600_000)),
      ),
    );

    function Switcher() {
      const [selected, setSelected] = useState(serversMultiple.servers[0]);
      return (
        <>
          <button onClick={() => setSelected(serversMultiple.servers[0])}>select A</button>
          <button onClick={() => setSelected(serversMultiple.servers[1])}>select B</button>
          <ServerContext value={selected}>
            <AutoPauseView />
          </ServerContext>
        </>
      );
    }
    renderWithClient(<Switcher />);
    await screen.findByRole("checkbox");
    fireEvent.click(checkbox());
    await screen.findByText("Saving…");

    fireEvent.click(screen.getByRole("button", { name: "select B" }));
    await waitFor(() => expect(checkbox()).toBeEnabled());
    fireEvent.click(checkbox()); // server B starts its own, unrelated change

    fireEvent.click(screen.getByRole("button", { name: "select A" }));

    // Server A's command was never answered, so it should still read as pending.
    await screen.findByText("Saving…");
    expect(checkbox()).toBeDisabled();
  });
});
