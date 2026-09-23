import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints, type LoginRequest } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { ApiError, classifyError } from "../api/errors";
import { LOGIN_MUTATION_KEY, SESSION_KEY } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";

export function LoginForm() {
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
    onSuccess: (session) => client.setQueryData(SESSION_KEY, session),
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
    <form onSubmit={onSubmit} aria-labelledby="login-heading">
      <h2 id="login-heading">Sign in</h2>
      <label>
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
      <label>
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
      <button type="submit" disabled={login.isPending}>
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
