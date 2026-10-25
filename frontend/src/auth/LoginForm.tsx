import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints, type LoginRequest } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { ApiError, classifyError } from "../api/errors";
import { LOGIN_MUTATION_KEY, SESSION_KEY } from "../api/queries";
import { clearSignedOutNotice, signedOutNotice } from "../api/signedOutNotice";
import { ErrorNotice } from "../components/ErrorNotice";
import {
  googleStartHref,
  needsTermsReaccept,
  needsTermsStep,
  offersGoogle,
  offersSignup,
  signInErrorText,
  TERMS_CHANGES,
  termsReturnPath,
} from "./googleSignIn";

const GOOGLE_BUTTON =
  "inline-flex min-h-touch items-center justify-center rounded-lg border border-accent bg-accent px-button-x font-semibold text-on-accent no-underline disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The sign-in screen (ADR-0011, ADR-0025): "Sign in with Google" when the backend offers it,
 * and the operator's password form (until ADR-0025 PR 9).
 */
export function LoginForm({ signInMethods }: { signInMethods?: readonly string[] }) {
  // The address as loaded: the Google link is a full-page navigation, and the backend's error
  // redirect is a fresh page load, so there's no need to follow client-side navigation here.
  const { pathname, search } = window.location;
  const urlError = signInErrorText(search);
  const notice = signedOutNotice();
  // The terms step (ADR-0046 question 6) shows only when sign-up is open AND Google just found no account
  // for this sign-in: an existing account never sees it. The box starts unticked, on purpose.
  const termsStep = offersSignup(signInMethods) && needsTermsStep(search);
  // #568: an existing account that accepted an older version accepts this one, whatever the sign-up mode.
  const reacceptStep = !termsStep && needsTermsReaccept(search);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const client = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // The credentials go to mutationFn through this ref, not as mutation variables: TanStack
  // keeps a mutation's variables in its cache for minutes, and the password shouldn't live
  // there. The ref is cleared as soon as the request is built.
  const credentials = useRef<LoginRequest | null>(null);
  const login = useMutation({
    mutationKey: LOGIN_MUTATION_KEY,
    mutationFn: () => {
      const body = credentials.current;
      credentials.current = null;
      if (!body) throw new Error("login submitted without credentials");
      return apiSend(endpoints.auth.login, body);
    },
    onSuccess: async (session) => {
      // A session check sent before the cookie existed (e.g. a focus refetch) would land after
      // this and sign the operator straight back out, so drop it first.
      await client.cancelQueries({ queryKey: SESSION_KEY });
      clearSignedOutNotice();
      client.setQueryData(SESSION_KEY, session);
    },
    onError: () => setPassword(""),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // login.isPending only updates on the next render, so a fast double Enter would send two
    // POSTs (and count twice against the rate limit). isMutating updates synchronously.
    if (client.isMutating({ mutationKey: LOGIN_MUTATION_KEY }) > 0) return;
    credentials.current = { username, password };
    login.mutate();
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="login-heading"
      className="mx-auto mt-6 grid w-full max-w-sm gap-4 rounded-card border border-line bg-surface p-6"
    >
      <h2 id="login-heading">Sign in</h2>
      {notice && (
        // ADR-0047: why the app just signed out (the account was deleted). A status, not an alert: nothing failed.
        <p role="status" className="mb-0 rounded-card border border-ok bg-ok-soft p-3 text-sm">
          {notice}
        </p>
      )}
      {urlError && !(reacceptStep && offersGoogle(signInMethods)) && (
        // The global [role="alert"] style gives it the error look (index.css); red text on
        // that red-tinted background would fail contrast.
        <p role="alert">
          {urlError}
        </p>
      )}
      {offersGoogle(signInMethods) && (
        <>
          {/* A link, not fetch: the backend answers with a redirect to Google. */}
          {termsStep || reacceptStep ? (
            <fieldset className="grid gap-3 border-0 p-0">
              <legend className="mb-2 font-semibold">{reacceptStep ? "The Terms have changed" : "Create your account"}</legend>
              {reacceptStep && (
                // An expected step, not a failure: no alert banner, the legend is the heading.
                <div className="mb-1 grid gap-1 text-sm">
                  <p className="mb-1">You accepted an earlier version. Accept this one to continue.</p>
                  <p className="mb-0 font-semibold text-muted">What changed:</p>
                  <ul className="mb-0 grid list-disc gap-1 pl-5">
                    {TERMS_CHANGES.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                </div>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  I accept the{" "}
                  <a href="/terms.html" target="_blank" rel="noopener noreferrer">
                    {reacceptStep ? "updated Terms" : "Terms"} (opens in a new tab)
                  </a>
                  .
                </span>
              </label>
              {acceptedTerms ? (
                <a href={googleStartHref(pathname, true, termsReturnPath(search))} className={GOOGLE_BUTTON}>
                  Continue with Google
                </a>
              ) : (
                <button type="button" disabled className={GOOGLE_BUTTON}>
                  Continue with Google
                </button>
              )}
              {reacceptStep && (
                // No session exists until the new version is accepted: declining just leaves the person signed out.
                <a href="/app/login" className="inline-flex min-h-touch items-center justify-self-center text-sm">
                  Decline and stay signed out
                </a>
              )}
            </fieldset>
          ) : (
            <a href={googleStartHref(pathname)} className={GOOGLE_BUTTON}>
              Sign in with Google
            </a>
          )}
          <p className="flex items-center gap-3 text-sm text-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
            or
          </p>
        </>
      )}
      <label className="grid gap-1.5 text-sm">
        Username
        <input
          name="username"
          autoComplete="username"
          required
          maxLength={128}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label className="grid gap-1.5 text-sm">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button
        type="submit"
        disabled={login.isPending}
        // With Google offered, that's the main way in; the password button steps back.
        className={
          offersGoogle(signInMethods) ? "mt-1 font-semibold" : "mt-1 border-accent bg-accent font-semibold text-on-accent hover:border-accent"
        }
      >
        {login.isPending ? "Signing in…" : "Sign in"}
      </button>
      {login.isError && <LoginError error={login.error} />}
    </form>
  );
}

function LoginError({ error }: { error: unknown }) {
  switch (classifyError(error)) {
    case "unauthorized":
      // The backend's message deliberately doesn't say which field was wrong.
      return <p role="alert">{(error as ApiError).message}</p>;
    case "rate_limited":
      return <p role="alert">Too many sign-in attempts. Try again later.</p>;
    default:
      return <ErrorNotice error={error} />;
  }
}
