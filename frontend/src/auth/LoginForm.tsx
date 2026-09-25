import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints, type LoginRequest } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { ApiError, classifyError } from "../api/errors";
import { LOGIN_MUTATION_KEY, SESSION_KEY } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { googleStartHref, offersGoogle, signInErrorText } from "./googleSignIn";

/**
 * The sign-in screen (ADR-0011, ADR-0025): "Sign in with Google" when the backend offers it,
 * and the operator's password form (until ADR-0025 PR 9).
 */
export function LoginForm({ signInMethods }: { signInMethods?: readonly string[] }) {
  // The address as loaded: the Google link is a full-page navigation, and the backend's error
  // redirect is a fresh page load, so there's no need to follow client-side navigation here.
  const { pathname, search } = window.location;
  const urlError = signInErrorText(search);
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
      {urlError && (
        // The global [role="alert"] style gives it the error look (index.css); red text on
        // that red-tinted background would fail contrast.
        <p role="alert">
          {urlError}
        </p>
      )}
      {offersGoogle(signInMethods) && (
        <>
          {/* A link, not fetch: the backend answers with a redirect to Google. */}
          <a
            href={googleStartHref(pathname)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-accent bg-accent px-[14px] font-semibold text-on-accent no-underline"
          >
            Sign in with Google
          </a>
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
