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
  KEPT_HEADING,
  OPERATOR_CANNOT_DELETE,
  OPERATOR_SERVERS_LEAD,
  OPERATOR_SERVERS_THEN,
  REAUTH_LEAD,
  REAUTH_PASSWORD,
  REAUTH_THEN,
  REMOVED_HEADING,
  deleteRefusal,
  serversRemovedWithAccount,
} from "./accountText";

/** Where the Google round trip comes back to (ADR-0047 decision 5): Settings, where the person can try again. */
const RETURN_TO = "/app/settings";

/** The panel's danger border (the bad-edge token, as on error notices). */
const DANGER_ZONE = "border-bad-edge";
/** The confirm step's inset: bordered and tinted in the danger tokens. */
const CONFIRM_INSET = "grid gap-2 rounded-card border border-bad-edge bg-bad-soft p-4";
/** The re-sign-in notice: a warning tone over the global alert's red (a routine step, not an error). */
const NOTICE_TONE = "border-warn-edge bg-warn-soft text-fg-strong";
/** A link that looks like a secondary button, with the 44 px touch target. */
const SECONDARY_LINK_BUTTON =
  "inline-flex min-h-touch items-center justify-center rounded-control border border-line bg-surface-2 px-button-x font-semibold text-fg-strong no-underline hover:border-muted";

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
    // The danger zone (ui review): set apart from the cards above by a wider gap and the danger border.
    <section aria-labelledby={headingId} className={`panel mt-4 grid gap-3 ${DANGER_ZONE}`}>
      <h3 id={headingId}>Delete my account</h3>
      {/* While confirming, the confirm says it all: the explainer steps aside. */}
      {!confirming && (
        <div className="grid gap-3 text-sm">
          <div role="group" aria-labelledby={`${headingId}-removed`} className="grid gap-1">
            <h4 id={`${headingId}-removed`} className="m-0 text-sm font-semibold">
              {REMOVED_HEADING}
            </h4>
            <ul className="mb-0 list-disc pl-5">
              {DELETE_GOES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="mb-0">{DELETE_SERVERS_GO}</p>
          </div>
          <div role="group" aria-labelledby={`${headingId}-kept`} className="grid gap-1">
            <h4 id={`${headingId}-kept`} className="m-0 text-sm font-semibold">
              {KEPT_HEADING}
            </h4>
            <p className="mb-0">{GAME_UNTOUCHED}</p>
            <p className="mb-0 text-muted">
              {DELETE_KEPT}{" "}
              <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
                Privacy policy <span className="sr-only">(opens in a new tab)</span>
              </a>
            </p>
          </div>
        </div>
      )}

      {confirming ? (
        <form
          onSubmit={confirm}
          onKeyDown={escapeCancels}
          aria-label="Confirm deleting your account"
          className="grid animate-reveal gap-3 text-sm"
        >
          {/* Its own step: a bordered inset in the danger tokens. The refusal's notice takes focus when there is one. */}
          <div ref={remove.isError ? undefined : focusIn} tabIndex={-1} className={CONFIRM_INSET}>
            <p className="mb-0 font-semibold">Delete your account now?</p>
            <p className="mb-0 font-semibold text-bad-on-soft">This can't be undone.</p>
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
            <p className="mb-0">{GAME_UNTOUCHED}</p>
          </div>
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
    // Styled by the global [role="alert"] rule, like every other error (index.css), except the routine re-sign-in, which
    // is not an error: it takes the warning tone instead.
    <div role="alert" ref={focusRef} tabIndex={-1} className={refusal.kind === "reauth" ? `grid gap-2 ${NOTICE_TONE}` : "grid gap-2"}>
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
          {/* A full-page navigation (the backend redirects to Google), styled as a secondary button. */}
          <a href={googleStartHref(RETURN_TO)} className={SECONDARY_LINK_BUTTON}>
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
