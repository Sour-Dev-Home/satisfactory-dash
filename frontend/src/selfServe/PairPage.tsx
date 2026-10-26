import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { PairingLookupResponse, ServerSummary } from "@satisfactory-dash/shared";
import { usePairingApprove, usePairingLookup } from "../api/pairingWrites";
import { queries } from "../api/queries";
import { AccountMenu } from "../auth/AccountMenu";
import { ErrorNotice } from "../components/ErrorNotice";
import { DEMO_PAIR_CODE } from "../demo/pairCode";
import { IS_DEMO } from "../demo/mode";
import { Loadable, Skeleton, SkeletonStatus } from "../ui/Skeleton";
import { CODE_EXAMPLE, CODE_WHERE, askedText, codeProblem, formatCode, pairErrorText, type PairError } from "./pairText";

/**
 * "Pair a server" (ADR-0051 section 1, ADR-0057 D6; RFC 8628 "confirm the device"). Three steps in one place: type the
 * code the server shows, check who is asking, approve it as a new server or as one of the person's own.
 *
 * The code is only ever typed: a `?code=` in the URL is ignored and removed, and the code is never stored. The server's
 * name is the agent's own words (untrusted), so it is rendered as text and nothing else.
 */
export function PairPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Nothing prefills the code: drop a query code from the address bar and never read it.
  const hasCodeParam = new URLSearchParams(location.search).has("code");
  useEffect(() => {
    if (hasCodeParam) void navigate({ pathname: location.pathname }, { replace: true });
  }, [hasCodeParam, location.pathname, navigate]);

  const lookup = usePairingLookup();
  const approve = usePairingApprove();
  const [confirm, setConfirm] = useState<{ code: string; found: PairingLookupResponse; at: number } | null>(null);
  const [paired, setPaired] = useState<string | null>(null);

  const heading = useRef<HTMLHeadingElement>(null);
  const step = paired !== null ? "done" : confirm ? "confirm" : "enter";
  const first = useRef(true);
  useEffect(() => {
    // Not on arrival (the page title is read anyway); on each later step.
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const startOver = () => {
    approve.reset();
    lookup.reset();
    setConfirm(null);
  };

  return (
    <div className="mx-auto mt-6 grid w-full max-w-md gap-4">
      <div className="flex justify-end">
        <AccountMenu />
      </div>
      <section aria-labelledby="pair-heading" className="grid gap-4 rounded-card border border-line bg-surface p-6">
        <h2 id="pair-heading" ref={heading} tabIndex={-1} className="mb-0">
          {step === "done" ? "Server paired" : step === "confirm" ? "Is this your server?" : "Pair a server"}
        </h2>
        {step === "enter" && (
          <CodeStep
            busy={lookup.isPending}
            error={lookup.error}
            onSubmit={async (code) => {
              const found = await lookup.mutateAsync(code);
              setConfirm({ code, found, at: Date.now() });
              lookup.reset();
            }}
          />
        )}
        {step === "confirm" && confirm && (
          <ConfirmStep
            found={confirm.found}
            askedAt={confirm.at}
            busy={approve.isPending}
            error={approve.error}
            onBack={startOver}
            onApprove={async (target) => {
              const answer = await approve.mutateAsync({ userCode: confirm.code, target });
              approve.reset();
              setConfirm(null);
              setPaired(answer.serverId);
            }}
          />
        )}
        {step === "done" && paired !== null && (
          <div className="grid gap-3">
            <p role="status" className="mb-0">
              Paired. Data arrives within a few seconds.
            </p>
            {/* The selection rides in the router's state, not the URL, so ServerGate can open this server. */}
            <p className="mb-0">
              <Link to="/app" state={{ selectServerId: paired }}>
                Open the dashboard
              </Link>
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function ErrorLine({ shown, error }: { shown: PairError | undefined; error: unknown }) {
  if (error == null) return null;
  if (!shown) return <ErrorNotice error={error} />;
  return (
    <p
      role="alert"
      className={shown.limit ? "mb-0 rounded-card border border-warn bg-warn-soft p-3 text-fg-strong" : "mb-0 font-medium text-bad-on-soft"}
    >
      {shown.text}
    </p>
  );
}

function CodeStep({ busy, error, onSubmit }: { busy: boolean; error: unknown; onSubmit: (code: string) => Promise<unknown> }) {
  const id = useId();
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const sending = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending.current || busy) return;
    const found = codeProblem(code);
    setProblem(found);
    if (found) {
      input.current?.focus();
      return;
    }
    sending.current = true;
    void onSubmit(code).then(
      () => {
        sending.current = false;
      },
      () => {
        sending.current = false;
      },
    );
  };

  const helpId = `${id}-help`;
  const problemId = `${id}-problem`;
  const refusalId = `${id}-refusal`;
  const describedBy = [helpId, problem && problemId, error != null && refusalId].filter(Boolean).join(" ");
  return (
    <>
      <p className="mb-0 text-sm text-muted">
        Start pairing on your game server, then type the code it shows. Find the code {CODE_WHERE}.
      </p>
      {IS_DEMO && (
        <p className="mb-0 text-sm text-muted">
          This is the demo: <code>{DEMO_PAIR_CODE}</code> pairs with the made-up factory.
        </p>
      )}
      <form onSubmit={submit} noValidate className="grid gap-2 text-sm">
        <label htmlFor={`${id}-code`}>Pairing code</label>
        <input
          id={`${id}-code`}
          ref={input}
          className="font-mono tracking-wide aria-[invalid=true]:border-bad"
          value={code}
          onChange={(e) => {
            setCode(formatCode(e.target.value));
            if (problem) setProblem(undefined);
          }}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={CODE_EXAMPLE}
          maxLength={14}
          aria-invalid={problem ? true : undefined}
          aria-describedby={describedBy}
        />
        <span id={helpId} className="text-muted">
          Twelve letters and digits, like {CODE_EXAMPLE}. Dashes and lower case are fine.
        </span>
        {problem && (
          <span id={problemId} role="alert" className="font-medium text-bad-on-soft">
            {problem}
          </span>
        )}
        <div>
          <button type="submit" disabled={busy} className="border-accent bg-accent text-on-accent hover:not-disabled:border-accent">
            {busy ? "Checking…" : "Continue"}
          </button>
        </div>
        <div id={refusalId} aria-live="polite">
          <ErrorLine shown={pairErrorText(error)} error={error} />
        </div>
      </form>
    </>
  );
}

/** The servers this person may re-pair: the ones they own or administer (the backend decides again). */
const canRepair = (s: Pick<ServerSummary, "role">) => s.role === "owner" || s.role === "admin";

function ConfirmStep({
  found,
  askedAt,
  busy,
  error,
  onBack,
  onApprove,
}: {
  found: PairingLookupResponse;
  askedAt: number;
  busy: boolean;
  error: unknown;
  onBack: () => void;
  onApprove: (target: { kind: "new" } | { kind: "existing"; serverId: string }) => Promise<unknown>;
}) {
  const id = useId();
  const servers = useQuery(queries.servers());
  const mine = (servers.data?.servers ?? []).filter(canRepair);
  const [kind, setKind] = useState<"new" | "existing">("new");
  const [serverId, setServerId] = useState("");
  const sending = useRef(false);
  const chosen = kind === "existing" ? (mine.find((s) => s.id === serverId)?.id ?? mine[0]?.id) : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending.current || busy) return;
    if (kind === "existing" && chosen === undefined) return;
    sending.current = true;
    const target = kind === "existing" && chosen !== undefined ? { kind: "existing" as const, serverId: chosen } : { kind: "new" as const };
    void onApprove(target).then(
      () => {
        sending.current = false;
      },
      () => {
        sending.current = false;
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 text-sm">
      <p className="mb-0 text-muted">Only approve a server you started pairing yourself.</p>
      <dl className="m-0 grid gap-2">
        <div>
          <dt className="text-muted">Server name</dt>
          {/* The agent's own words: plain text, never markup. */}
          <dd className="m-0 break-words font-medium text-fg-strong">{found.serverName ?? "This server did not give a name."}</dd>
        </div>
        <div>
          <dt className="text-muted">Version</dt>
          <dd className="m-0">{found.agentVersion}</dd>
        </div>
        <div>
          <dt className="text-muted">Requested</dt>
          <dd className="m-0">{askedText(found.requestedAt, askedAt)}</dd>
        </div>
      </dl>
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 p-0">Pair it as</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name={`${id}-kind`} checked={kind === "new"} onChange={() => setKind("new")} />A new server
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`${id}-kind`}
            checked={kind === "existing"}
            onChange={() => setKind("existing")}
            disabled={servers.isSuccess && mine.length === 0}
          />
          One of my servers
        </label>
        {servers.isSuccess && mine.length === 0 && <span className="text-muted">You have no server you can re-pair yet.</span>}
      </fieldset>
      {kind === "existing" && (
        <Loadable
          pending={servers.isPending}
          className="grid gap-2"
          skeleton={
            <>
              <SkeletonStatus>Loading your servers</SkeletonStatus>
              <Skeleton className="h-lh w-32" />
              <Skeleton className="h-10" />
            </>
          }
        >
          {servers.isError ? (
            <ErrorNotice
              error={servers.error}
              action={
                <button type="button" onClick={() => void servers.refetch()}>
                  Retry
                </button>
              }
            />
          ) : (
            <>
              <label htmlFor={`${id}-server`}>Server to re-pair</label>
              <select id={`${id}-server`} value={chosen ?? ""} onChange={(e) => setServerId(e.target.value)} aria-describedby={`${id}-replace`}>
                {mine.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                  </option>
                ))}
              </select>
              <span id={`${id}-replace`} className="text-muted">
                This replaces that server's credential: whatever is connected to it now stops working, and the server that is pairing
                takes its place.
              </span>
            </>
          )}
        </Loadable>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || (kind === "existing" && chosen === undefined)}
          className="border-accent bg-accent text-on-accent hover:not-disabled:border-accent"
        >
          {busy ? "Approving…" : "Approve"}
        </button>
        <button type="button" onClick={onBack} disabled={busy}>
          Use a different code
        </button>
      </div>
      <div aria-live="polite">
        <ErrorLine shown={pairErrorText(error)} error={error} />
      </div>
    </form>
  );
}
