import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { endpoints, type AlertDestinationsResponse, type AlertRulesResponse } from "@satisfactory-dash/shared";
import {
  alertDestinationsConfigured,
  alertPatchDiscordResponseDisabledManually,
  alertRuleCreated,
  alertRulesList,
  errorForbidden,
  errorPresetDisableOnly,
  serversSingle,
} from "@satisfactory-dash/shared/fixtures";
import { server } from "../test/server";
import { useAlertWrites } from "./alertWrites";
import { createQueryClient, queries } from "./queries";

const SERVER = serversSingle.servers[0].id;

function setup() {
  const client = createQueryClient();
  client.setQueryData(queries.alertRules(SERVER).queryKey, alertRulesList);
  client.setQueryData(queries.alertDestinations(SERVER).queryKey, alertDestinationsConfigured);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useAlertWrites(SERVER), { wrapper });
  const rules = () => client.getQueryData<AlertRulesResponse>(queries.alertRules(SERVER).queryKey)?.rules;
  const destinations = () => client.getQueryData<AlertDestinationsResponse>(queries.alertDestinations(SERVER).queryKey);
  return { client, result, rules, destinations };
}

describe("useAlertWrites", () => {
  it("adds a created rule to the cached list from the backend's answer", async () => {
    server.use(http.post(endpoints.alerts.rules.create.route, () => HttpResponse.json(alertRuleCreated, { status: 201 })));
    const { result, rules } = setup();
    await act(() =>
      result.current.createRule.mutateAsync({
        kind: "production_below_target",
        params: { item: "Desc_IronPlate_C", targetPerMinute: 120 },
      }),
    );
    expect(rules()).toHaveLength(alertRulesList.rules.length + 1);
    expect(rules()?.at(-1)?.id).toBe(alertRuleCreated.rule.id);
  });

  it("drops a deleted rule, and leaves the list alone when the backend refuses", async () => {
    const custom = alertRulesList.rules.find((r) => !r.preset)!;
    const preset = alertRulesList.rules.find((r) => r.preset)!;
    server.use(
      http.delete(endpoints.alerts.rules.remove.route, ({ params }) =>
        params.ruleId === preset.id
          ? HttpResponse.json(errorPresetDisableOnly, { status: 409 })
          : HttpResponse.json({ deleted: true }),
      ),
    );
    const { result, rules } = setup();
    await act(() => result.current.deleteRule.mutateAsync(custom.id));
    expect(rules()?.some((r) => r.id === custom.id)).toBe(false);
    await act(() => expect(result.current.deleteRule.mutateAsync(preset.id)).rejects.toThrow());
    expect(rules()?.some((r) => r.id === preset.id)).toBe(true);
  });

  it("never keeps the webhook URL: not in the query cache, and not as a mutation's variables", async () => {
    const url = "https://discord.com/api/webhooks/1/secret-token-9999";
    let sent: unknown;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.put(endpoints.alerts.destinations.putDiscord.route, async ({ request }) => {
        sent = await request.json();
        await held;
        return HttpResponse.json(alertDestinationsConfigured);
      }),
    );
    const { client, result } = setup();
    const mutationState = () =>
      JSON.stringify(client.getMutationCache().getAll().map((m) => ({ variables: m.state.variables, data: m.state.data })));

    let saving!: Promise<unknown>;
    act(() => {
      saving = result.current.saveWebhook(url);
    });
    // In flight: the request carries it, but the mutation doesn't hold it.
    await waitFor(() => expect(sent).toEqual({ webhookUrl: url }));
    expect(mutationState()).not.toContain("secret-token");

    release();
    await act(() => saving);
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toContain("secret-token");
    expect(mutationState()).not.toContain("secret-token");
  });

  it("refuses a webhook save without a URL rather than sending an empty body", async () => {
    let calls = 0;
    server.use(
      http.put(endpoints.alerts.destinations.putDiscord.route, () => {
        calls++;
        return HttpResponse.json(alertDestinationsConfigured);
      }),
    );
    const { result } = setup();
    await act(() => expect(result.current.putDiscord.mutateAsync()).rejects.toThrow(/without a URL/));
    expect(calls).toBe(0);
  });

  it("updates the destination from a PATCH, and clears it on DELETE", async () => {
    server.use(
      http.patch(endpoints.alerts.destinations.patchDiscord.route, () => HttpResponse.json(alertPatchDiscordResponseDisabledManually)),
      http.delete(endpoints.alerts.destinations.removeDiscord.route, () => HttpResponse.json({ deleted: true })),
    );
    const { result, destinations } = setup();
    await act(() => result.current.patchDiscord.mutateAsync(false));
    expect(destinations()?.discord?.disabledReason).toBe("manual");
    await act(() => result.current.removeDiscord.mutateAsync());
    expect(destinations()).toEqual({ discord: null });
  });

  it("re-reads the destination after a send test, whatever it answered", async () => {
    let reads = 0;
    server.use(
      http.post(endpoints.alerts.destinations.testDiscord.route, () => HttpResponse.json({ ok: false, code: "webhook_gone" })),
      http.get(endpoints.alerts.destinations.get.route, () => {
        reads++;
        return HttpResponse.json(alertDestinationsConfigured);
      }),
    );
    // A page watching the destination, as the Alerts page does: only a watched query is re-read.
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => ({ read: useQuery(queries.alertDestinations(SERVER)), writes: useAlertWrites(SERVER) }), { wrapper });
    await waitFor(() => expect(result.current.read.isSuccess).toBe(true));
    const before = reads;
    await act(() => result.current.writes.testDiscord.mutateAsync());
    await waitFor(() => expect(reads).toBe(before + 1));
  });

  it("never puts a write's answer back into the cache once the session ended while it was in flight", async () => {
    server.use(http.patch(endpoints.alerts.destinations.patchDiscord.route, () => HttpResponse.json(alertPatchDiscordResponseDisabledManually)));
    const { client, result, destinations } = setup();
    client.setQueryData(queries.session().queryKey, { authenticated: false });
    await act(() => result.current.patchDiscord.mutateAsync(false));
    expect(destinations()).toEqual(alertDestinationsConfigured);
  });

  it("passes a viewer's 403 back to the caller, changing nothing", async () => {
    server.use(http.put(endpoints.alerts.mute.set.route, () => HttpResponse.json(errorForbidden, { status: 403 })));
    const { result } = setup();
    await act(() => expect(result.current.setMute.mutateAsync("2026-09-26T18:00:00.000Z")).rejects.toMatchObject({ status: 403 }));
  });
});
