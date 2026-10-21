import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints, type PushSubscribeRequest } from "@satisfactory-dash/shared";
import { apiSend } from "./client";
import { isSignedOut, queries } from "./queries";

/**
 * The web push writes (ADR-0044, #348). A subscription's endpoint and keys are secrets (the endpoint is a
 * capability URL on a push service), so `subscribeDevice` passes them through a ref, not as the mutation's
 * `variables` (TanStack keeps those in its cache and devtools show them), and the mutation isn't kept once it
 * settles (gcTime 0): the same reason `saveWebhook` does it. Everything else here holds ids and flags only.
 */
export function usePushWrites(serverId: string) {
  const client = useQueryClient();
  const optInKey = queries.pushOptIn(serverId).queryKey;

  const pending = useRef<PushSubscribeRequest | null>(null);
  const subscribe = useMutation({
    mutationFn: () => {
      const body = pending.current;
      pending.current = null;
      if (body === null) throw new Error("push subscription submitted without a body");
      return apiSend(endpoints.push.subscribe, body);
    },
    gcTime: 0,
  });
  /** POST the browser's subscription. Idempotent on the backend: the same endpoint answers the same id. */
  const subscribeDevice = (body: PushSubscribeRequest) => {
    pending.current = body;
    return subscribe.mutateAsync();
  };

  const unsubscribe = useMutation({ mutationFn: (id: string) => apiSend(endpoints.push.unsubscribe, undefined, id) });
  const test = useMutation({ mutationFn: (id: string) => apiSend(endpoints.push.test, undefined, id) });

  const setOptIn = useMutation({
    mutationFn: (optedIn: boolean) => apiSend(endpoints.push.optIn.put, { optedIn }, serverId),
    onSuccess: async (answer) => {
      await client.cancelQueries({ queryKey: optInKey });
      if (!isSignedOut(client)) client.setQueryData(optInKey, answer);
    },
  });

  return { subscribe, subscribeDevice, unsubscribe, test, setOptIn };
}
