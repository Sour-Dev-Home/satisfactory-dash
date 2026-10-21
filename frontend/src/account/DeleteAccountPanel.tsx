import { useCallback, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionResponse } from "@satisfactory-dash/shared";
import { isDeletingAccount, useDeleteAccount } from "../api/accountWrites";
import { queries, SESSION_KEY } from "../api/queries";
import { googleStartHref, offersGoogle } from "../auth/googleSignIn";
import { LogoutButton } from "../auth/LogoutButton";
import { useSignedInUser } from "../auth/SignedInUser";
import { DANGER_BUTTON, DANGER_BUTTON_QUIET } from "../components/dangerButton";
import { ErrorNotice } from "../components/ErrorNotice";
import {
  DELETE_GOES,
  DELETE_KEPT,
  DELETE_SERVERS_GO,
  GAME_UNTOUCHED,
  OPERATOR_CANNOT_DELETE,
  OPERATOR_SERVERS_LEAD,
  OPERATOR_SERVERS_THEN,
  REAUTH_LEAD,
  REAUTH_PASSWORD,
  REAUTH_THEN,
  deleteRefusal,
  serversRemovedWithAccount,
} from "./accountText";

/** Where the Google round trip comes back to (ADR-0047 decision 5): Settings, where the person can try again. */
const RETURN_TO = "/app/settings";

/**
 * Settings → Delete my account (ADR-0047). Says what goes and what stays, then deletes behind an explicit confirm. The
 * real guard is the backend's recent-sign-in rule: an older session gets 403 reauth_required, and this offers the
 * sign-in the app already has (Google, back to Settings; or sign out and in again for a password account). The
 * operator gets a line instead of the button (the backend refuses the operator's account anyway). Needs no selected
 * server, so the no-server screen can show it too.
 */
export function DeleteAccountPanel() {
  const client = useQueryClient();
  const list = useQuery(queries.servers()).data;
  const remove = useDeleteAccount();
  const [confirming, setConfirming] = useState(false);
  const [returnFocus, setReturnFocus] = useState(false);
  // Focus follows the control that replaces the one clicked, and returns to the opener on cancel.
  const focusIn = useCallback((el: HTMLElement | null) => el?.focus(), []);
  const headingId = useId();
  const user = useSignedInUser();

  // Without a database there is no stored account to delete (the route isn't there): the session then names no methods.
  if (user?.authMethods === undefined) return null;
  if (list?.canManageServers === true) {
    return (
      <section aria-labelledby={headingId} className="panel grid gap-3">
        <h3 id={headingId}>Delete my account</h3>
        <p className="mb-0 text-sm text-muted">{OPERATOR_CANNOT_DELETE}</p>
      </section>
    );
  }

  const removed = serversRemovedWithAccount(list?.servers ?? []);
  const cancel = () => {
    setConfirming(false);
    setReturnFocus(true);
    remove.reset();
  };
  const confirm = (event: FormEvent) => {
    event.preventDefault();
    if (!isDeletingAccount(client)) remove.mutate();
  };
  const escapeCancels = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !remove.isPending) {
      event.stopPropagation();
      cancel();
    }
  };

  return (
    <section aria-labelledby={headingId} className="panel grid gap-3">
      <h3 id={headingId}>Delete my account</h3>
      <div className="grid gap-1 text-sm">
        <p className="mb-0">Deleting your account removes:</p>
        <ul className="mb-0 list-disc pl-5">
          {DELETE_GOES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mb-0">{DELETE_SERVERS_GO}</p>
        <p className="mb-0">{GAME_UNTOUCHED}</p>
        <p className="mb-0 text-muted">
          {DELETE_KEPT}{" "}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
            Privacy policy (opens in a new tab)
          </a>
        </p>
      </div>

      {confirming ? (
        <form
          onSubmit={confirm}
          onKeyDown={escapeCancels}
          aria-label="Confirm deleting your account"
          className="grid animate-reveal gap-2 text-sm"
        >
          {/* The refusal's own notice takes focus when there is one; otherwise the question does. */}
          <p ref={remove.isError ? undefined : focusIn} tabIndex={-1} className="mb-0 font-semibold">
            Delete your account now? This can't be undone.
          </p>
          {removed.length > 0 && (
            <div className="grid gap-1">
              <p className="mb-0">These servers you added are removed from Satisfactory Dash with it:</p>
              <ul className="mb-0 list-disc pl-5">
                {removed.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={cancel} disabled={remove.isPending}>
              Cancel
            </button>
            <button type="submit" className={DANGER_BUTTON} disabled={remove.isPending}>
              {remove.isPending ? "Deleting…" : "Delete my account"}
            </button>
          </div>
          {remove.isError && <Refusal error={remove.error} focusRef={focusIn} />}
        </form>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button
            ref={returnFocus ? focusIn : undefined}
            type="button"
            className={DANGER_BUTTON_QUIET}
            onClick={() => {
              setConfirming(true);
              setReturnFocus(false);
              remove.reset();
            }}
          >
            Delete my account…
          </button>
        </div>
      )}
    </section>
  );
}

/** One refusal, worded for this screen, with the way forward when there is one. Focus lands on it. */
function Refusal({ error, focusRef }: { error: unknown; focusRef: (el: HTMLElement | null) => void }) {
  const refusal = deleteRefusal(error);
  if (refusal.kind === "other") return <ErrorNotice error={error} />;
  return (
    // Styled by the global [role="alert"] rule, like every other error (index.css).
    <div role="alert" ref={focusRef} tabIndex={-1} className="grid gap-2">
      {refusal.kind === "reauth" ? (
        <Reauth />
      ) : refusal.kind === "operator_servers" ? (
        <>
          <p className="mb-0">{OPERATOR_SERVERS_LEAD}</p>
          <ul className="mb-0 list-disc pl-5">
            {refusal.servers.map((name, i) => (
              // Two servers can share a name: the position is the key.
              <li key={i}>{name}</li>
            ))}
          </ul>
          <p className="mb-0">{OPERATOR_SERVERS_THEN}</p>
        </>
      ) : (
        <p className="mb-0">{OPERATOR_CANNOT_DELETE}</p>
      )}
    </div>
  );
}

/** Google accounts go through Google again, back to Settings; a password account signs out and in again. */
function Reauth() {
  const client = useQueryClient();
  const authMethods = useSignedInUser()?.authMethods ?? [];
  // Google is offered only when the account has it linked and the backend still offers it (Google off answers 404).
  const google = authMethods.includes("google") && offersGoogle(client.getQueryData<SessionResponse>(SESSION_KEY)?.signInMethods);
  if (google) {
    return (
      <>
        <p className="mb-0">{REAUTH_LEAD}</p>
        <p className="mb-0">
          <a href={googleStartHref(RETURN_TO)} className="font-semibold underline">
            Sign in again with Google
          </a>
        </p>
        <p className="mb-0">{REAUTH_THEN}</p>
      </>
    );
  }
  return (
    <>
      <p className="mb-0">{REAUTH_LEAD}</p>
      <p className="mb-0">{REAUTH_PASSWORD}</p>
      <div>
        <LogoutButton />
      </div>
    </>
  );
}
