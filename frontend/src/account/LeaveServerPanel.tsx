import { useCallback, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useLeaveServer } from "../api/accountWrites";
import { DANGER_BUTTON, DANGER_BUTTON_QUIET } from "../components/dangerButton";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer, useServerSwitch } from "../servers/ServerContext";
import { LEAVE_EFFECT, OWNER_CANNOT_LEAVE, OWNER_REMOVE_INSTEAD, canLeave, isLastOwner, roleText } from "./accountText";

/**
 * Settings → Your membership (ADR-0047): the member's role on the selected server and, for anyone but the owner, "Leave
 * this server" behind a confirm. The owner gets the reason instead (the backend refuses them, 409 last_owner, which is
 * still worded here should the role have changed meanwhile). Nothing shows without a role: an older backend or the
 * no-database path has no membership to leave. On success ServerGate drops the selection and the list is read again.
 */
export function LeaveServerPanel() {
  const server = useSelectedServer();
  const { left } = useServerSwitch();
  // ServerGate drops the selection and says "You left {name}." wherever it lands, with focus there.
  const leave = useLeaveServer(server.id, () => left(server.displayName));
  const [confirming, setConfirming] = useState(false);
  const [returnFocus, setReturnFocus] = useState(false);
  const sending = useRef(false);
  const focusIn = useCallback((el: HTMLElement | null) => el?.focus(), []);
  const headingId = useId();
  if (server.role === undefined) return null;

  const cancel = () => {
    setConfirming(false);
    setReturnFocus(true);
    leave.reset();
  };
  const confirm = (event: FormEvent) => {
    event.preventDefault();
    // isPending lags two submits in the same tick; the ref doesn't (a second POST would answer server_not_found).
    if (sending.current) return;
    sending.current = true;
    leave.mutate(undefined, { onSettled: () => (sending.current = false) });
  };
  const escapeCancels = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !leave.isPending) {
      event.stopPropagation();
      cancel();
    }
  };

  return (
    <section aria-labelledby={headingId} className="panel grid gap-3">
      <h3 id={headingId}>Your membership</h3>
      {!canLeave(server) ? (
        <p className="mb-0 text-sm">
          You own {server.displayName}, so you can't leave it.
          {server.createdVia === "self_serve" && ` ${OWNER_REMOVE_INSTEAD}`}
        </p>
      ) : (
        <>
          <p className="mb-0 text-sm">
            Your role on {server.displayName}: {roleText(server.role)}.
          </p>
          {confirming ? (
            <form
              onSubmit={confirm}
              onKeyDown={escapeCancels}
              aria-label={`Confirm leaving ${server.displayName}`}
              className="grid animate-reveal gap-2 text-sm"
            >
              <div ref={focusIn} tabIndex={-1} className="grid gap-1">
                <p className="mb-0 font-semibold">Leave {server.displayName}?</p>
                <p className="mb-0">{LEAVE_EFFECT}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={cancel} disabled={leave.isPending}>
                  Cancel
                </button>
                <button type="submit" className={DANGER_BUTTON} disabled={leave.isPending}>
                  {leave.isPending ? "Leaving…" : "Leave server"}
                </button>
              </div>
              {leave.isError &&
                (isLastOwner(leave.error) ? (
                  <p role="alert" className="mb-0">
                    {OWNER_CANNOT_LEAVE}
                  </p>
                ) : (
                  <ErrorNotice error={leave.error} />
                ))}
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
                  leave.reset();
                }}
              >
                Leave this server…
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
