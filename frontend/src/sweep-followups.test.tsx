// Follow-ups from the #43 fresh-eyes sweep's observations: display rounding, the outage
// message, production-list keys, lost-server marking and stale settings.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  endpoints,
  type FactoryResponse,
  type PowerResponse,
  type SettingsResponse,
  type StatusResponse,
} from "@satisfactory-dash/shared";
import {
  errorServerNotFound,
  factoryMixed,
  powerCharging,
  powerOk,
  serversMultiple,
  settingsEditable,
  statusRunning,
} from "@satisfactory-dash/shared/fixtures";
import { FactoryPanel } from "./factory/FactoryPanel";
import { formatMW, formatPercent, roundForDisplay } from "./format";
import { PowerPanel } from "./power/PowerPanel";
import { ServerGate } from "./servers/ServerGate";
import { ServerSwitcher } from "./servers/ServerSwitcher";
import { useSelectedServer } from "./servers/ServerContext";
import { AutoPausePanel } from "./settings/AutoPausePanel";
import { StatusView } from "./status/StatusView";
import { renderWithClient } from "./test/render";
import { server } from "./test/server";

afterEach(() => vi.restoreAllMocks());

describe("display rounding", () => {
  it("never prints -0", () => {
    expect(formatMW(-0.03)).toBe("0 MW");
    expect(formatPercent(-0.01)).toBe("0%");
    expect(formatMW(-1.26)).toBe("-1.3 MW");
    expect(roundForDisplay(-0.04)).toBe(0);
    expect(Object.is(roundForDisplay(-0.04), -0)).toBe(false);
    expect(roundForDisplay(-0.06)).toBe(-0.1);
  });

  it("labels a battery flow that rounds to zero as Idle, not Discharging 0 MW", () => {
    const base = powerCharging.data.circuits[0];
    const trickle = {
      ...powerCharging,
      data: { ...powerCharging.data, circuits: [{ ...base, batteryDifferentialMW: -0.03 }] },
    } satisfies PowerResponse;
    render(<PowerPanel snapshot={trickle} />);
    const card = screen.getByRole("article", { name: "Circuit 0" });
    const flow = within(card).getByText("Battery flow", { selector: "dt" }).nextElementSibling;
    expect(flow).toHaveTextContent("Idle");
  });
});

describe("outage message", () => {
  it("never says '0 circuits' when hasOutage disagrees with the circuit statuses", () => {
    const odd = { ...powerOk, data: { ...powerOk.data, hasOutage: true } } satisfies PowerResponse;
    render(<PowerPanel snapshot={odd} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Power outage reported.");
    expect(alert).not.toHaveTextContent(/0 circuits/);
  });
});

describe("production list keys", () => {
  it("renders two outputs with the same class name without a React key warning", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const [first, ...rest] = factoryMixed.data.buildings;
    const output = first.production[0];
    const twin = { ...first, production: [output, { ...output, currentPerMinute: 1 }] };
    const snapshot = {
      ...factoryMixed,
      data: { ...factoryMixed.data, buildings: [twin, ...rest] },
    } satisfies FactoryResponse;
    render(<FactoryPanel snapshot={snapshot} />);
    expect(screen.getAllByText(new RegExp(`^${output.name}:`))).toHaveLength(2);
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  });
});

describe("lost-server marking", () => {
  it("clears the 'no longer available' note once the operator picks that server again", async () => {
    let missing = true;
    server.use(
      http.get(endpoints.servers.route, () => HttpResponse.json(serversMultiple)),
      http.get(endpoints.status.route, ({ params }) =>
        missing && params.serverId === "default"
          ? HttpResponse.json(errorServerNotFound, { status: 404 })
          : HttpResponse.json({ ...statusRunning, serverId: String(params.serverId) } satisfies StatusResponse),
      ),
    );
    function Selected() {
      return <p>selected {useSelectedServer().id}</p>;
    }
    renderWithClient(
      <ServerGate>
        <ServerSwitcher />
        <Selected />
        <StatusView />
      </ServerGate>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Satisfactory server" }));
    expect(await screen.findByText("The selected server is no longer available.")).toBeInTheDocument();

    missing = false;
    fireEvent.click(screen.getByRole("button", { name: "Satisfactory server" }));
    await screen.findByRole("region", { name: "Server status" });

    fireEvent.click(screen.getByRole("button", { name: "Change server" }));
    await screen.findByRole("heading", { name: "Choose a game server" });
    expect(screen.queryByText("The selected server is no longer available.")).not.toBeInTheDocument();
  });
});

describe("stale settings", () => {
  const stale = {
    ...settingsEditable,
    stale: true,
    observedAt: "2026-09-22T22:00:00.000Z",
  } satisfies SettingsResponse;

  it("says how old the settings are and holds the toggle", () => {
    render(<AutoPausePanel snapshot={stale} onChange={() => {}} saving={false} />);
    const note = `Showing last known settings from ${new Date(stale.observedAt).toLocaleString()}.`;
    expect(screen.getByText(new RegExp(note.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
    const box = screen.getByRole("checkbox");
    expect(box).toBeDisabled();
    // Disabled is the guard: browsers don't deliver clicks to a disabled input (jsdom's
    // fireEvent does, so there's no click assertion here).
    expect(box).toHaveAccessibleDescription(expect.stringContaining("Changes are unavailable"));
  });

  it("stays usable when the settings are fresh", () => {
    render(<AutoPausePanel snapshot={settingsEditable} onChange={() => {}} saving={false} />);
    expect(screen.getByRole("checkbox")).toBeEnabled();
    expect(screen.queryByText(/last known settings/)).not.toBeInTheDocument();
  });
});
