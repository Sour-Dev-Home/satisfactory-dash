import { waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { endpoints, type SessionResponse } from "@satisfactory-dash/shared";
import { sessionAuthenticatedWithAccount } from "@satisfactory-dash/shared/fixtures";
import { ApiError } from "../api/errors";
import { SESSION_KEY, createQueryClient } from "../api/queries";
import { clearSignedOutNotice, setSignedOutNotice, signedOutNotice } from "../api/signedOutNotice";
import { AuthGate } from "../auth/AuthGate";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";

afterEach(clearSignedOutNotice);

describe("account deletion hunt", () => {
  it("forgets the signed-out notice once someone is signed in, so it can't greet a later user's sign-out", async () => {
    setSignedOutNotice("Your account was deleted. Your game and its saves were not touched.");
    server.use(http.get(endpoints.auth.session.route, () => HttpResponse.json(sessionAuthenticatedWithAccount)));
    renderWithClient(
      <MemoryRouter>
        <AuthGate>
          <p>app</p>
        </AuthGate>
      </MemoryRouter>,
    );
    await waitFor(() => expect(signedOutNotice()).toBeNull());
  });

  it("keeps the sign-in methods when a stale poll answers 401 after the deletion signed out", async () => {
    const client = createQueryClient();
    const after: SessionResponse = { authenticated: false, signInMethods: ["google"] };
    client.setQueryData(SESSION_KEY, after);
    await client
      .fetchQuery({
        queryKey: ["stale"],
        queryFn: () => Promise.reject(new ApiError(401, { code: "unauthorized", message: "no", requestId: "r" })),
        retry: false,
      })
      .catch(() => undefined);
    expect(client.getQueryData(SESSION_KEY)).toEqual(after);
  });
});
