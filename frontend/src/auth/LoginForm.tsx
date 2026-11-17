import { useState } from "react";
import { signedOutNotice } from "../api/signedOutNotice";
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
 * The sign-in screen (ADR-0011, ADR-0025): "Sign in with Google" when the backend offers it, the only way in
 * since password login went (ADR-0025 PR 9). With Google not offered (or no list at all), it says so.
 */
export function LoginForm({ signInMethods }: { signInMethods?: readonly string[] }) {
  const google = offersGoogle(signInMethods);
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

  return (
    <section
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
      {urlError && !(reacceptStep && google) && (
        // The global [role="alert"] style gives it the error look (index.css); red text on
        // that red-tinted background would fail contrast.
        <p role="alert">
          {urlError}
        </p>
      )}
      {!google && (
        // No Google on this backend (or a backend too old to say): nothing can sign in.
        <p className="mb-0 text-muted">Sign-in isn't available on this server.</p>
      )}
      {google &&
        // A link, not fetch: the backend answers with a redirect to Google.
        (termsStep || reacceptStep ? (
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
        ))}
    </section>
  );
}
