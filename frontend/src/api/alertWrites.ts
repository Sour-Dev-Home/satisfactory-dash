import { useRef } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import {
  endpoints,
  type AlertDestinationsResponse,
  type AlertRulesResponse,
  type CreateAlertRuleRequest,
  type UpdateAlertRuleRequest,
} from "@satisfactory-dash/shared";
import { apiSend } from "./client";
import { isSignedOut, queries } from "./queries";

/**
 * The alerts writes (ADR-0027 PR 9), for the Alerts page's owner/admin controls. Each one keeps the
 * cache in step with the backend's answer; none guesses ahead of it (no optimistic updates). The
 * backend is the real control: a viewer's write answers 403, which the caller shows like any error.
 * Each returns the mutation, so the caller reads `isPending` and `error` and awaits `mutateAsync`.
 */
export function useAlertWrites(serverId: string) {
  const client = useQueryClient();
  const rulesKey = queries.alertRules(serverId).queryKey;
  const destinationsKey = queries.alertDestinations(serverId).queryKey;
  const statusKey = queries.alertStatus(serverId).queryKey;

  // A read in flight could land after the write with the old value, so cancel it first, and never
  // write the answer into the cache once the session has ended while the request was out.
  const settle = async (key: QueryKey, apply: () => void) => {
    await client.cancelQueries({ queryKey: key });
    if (!isSignedOut(client)) apply();
  };
  const changeRules = (change: (rules: AlertRulesResponse["rules"]) => AlertRulesResponse["rules"]) =>
    settle(rulesKey, () =>
      client.setQueryData<AlertRulesResponse>(rulesKey, (old) => (old ? { rules: change(old.rules) } : old)),
    );

  const createRule = useMutation({
    mutationFn: (body: CreateAlertRuleRequest) => apiSend(endpoints.alerts.rules.create, body, serverId),
    onSuccess: ({ rule }) => changeRules((rules) => [...rules, rule]),
  });

  const updateRule = useMutation({
    mutationFn: ({ ruleId, body }: { ruleId: string; body: UpdateAlertRuleRequest }) =>
      apiSend(endpoints.alerts.rules.update, body, serverId, ruleId),
    onSuccess: ({ rule }) => changeRules((rules) => rules.map((r) => (r.id === rule.id ? rule : r))),
  });

  const deleteRule = useMutation({
    mutationFn: (ruleId: string) => apiSend(endpoints.alerts.rules.remove, undefined, serverId, ruleId).then(() => ruleId),
    onSuccess: (ruleId) => changeRules((rules) => rules.filter((r) => r.id !== ruleId)),
  });

  const setDestination = (answer: AlertDestinationsResponse) =>
    settle(destinationsKey, () => client.setQueryData(destinationsKey, answer));

  // The webhook URL is a bearer secret. It travels through this ref, not as the mutation's `variables`:
  // TanStack keeps a mutation's variables in its cache after it settles (and devtools show them), the
  // same reason ServerForm.tsx passes a server's token this way. The ref is cleared as soon as the
  // request is built, and the mutation isn't kept once it settles (gcTime 0). Call `saveWebhook(url)`.
  const pendingWebhook = useRef<string | null>(null);
  const putDiscord = useMutation({
    mutationFn: () => {
      const webhookUrl = pendingWebhook.current;
      pendingWebhook.current = null;
      if (webhookUrl === null) throw new Error("webhook save submitted without a URL");
      return apiSend(endpoints.alerts.destinations.putDiscord, { webhookUrl }, serverId);
    },
    gcTime: 0,
    onSuccess: setDestination,
  });
  const saveWebhook = (webhookUrl: string) => {
    pendingWebhook.current = webhookUrl;
    return putDiscord.mutateAsync();
  };

  const patchDiscord = useMutation({
    mutationFn: (enabled: boolean) => apiSend(endpoints.alerts.destinations.patchDiscord, { enabled }, serverId),
    onSuccess: setDestination,
  });

  const removeDiscord = useMutation({
    mutationFn: () => apiSend(endpoints.alerts.destinations.removeDiscord, undefined, serverId),
    onSuccess: () => setDestination({ discord: null }),
  });

  // A test that finds the webhook gone disables the destination on the backend: re-read it.
  const testDiscord = useMutation({
    mutationFn: () => apiSend(endpoints.alerts.destinations.testDiscord, undefined, serverId),
    onSettled: () => client.invalidateQueries({ queryKey: destinationsKey }),
  });

  // Mute changes what the status says; re-read it rather than patch one field of it.
  const setMute = useMutation({
    mutationFn: (until: string) => apiSend(endpoints.alerts.mute.set, { until }, serverId),
    onSuccess: () => client.invalidateQueries({ queryKey: statusKey }),
  });

  const clearMute = useMutation({
    mutationFn: () => apiSend(endpoints.alerts.mute.clear, undefined, serverId),
    onSuccess: () => client.invalidateQueries({ queryKey: statusKey }),
  });

  return { createRule, updateRule, deleteRule, putDiscord, saveWebhook, patchDiscord, removeDiscord, testDiscord, setMute, clearMute };
}
