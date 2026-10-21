/**
 * A short line for the sign-in screen after the app signed itself out for a reason worth saying (ADR-0047: the account
 * was deleted). In memory only, never storage or the URL: a crafted link can't put it on screen, and a reload (or the
 * Google sign-in's full-page navigation) forgets it. Set it before signing out, so the sign-in screen has it on its
 * first render; a successful sign-in clears it.
 */
let notice: string | null = null;

export function setSignedOutNotice(text: string): void {
  notice = text;
}

export function signedOutNotice(): string | null {
  return notice;
}

export function clearSignedOutNotice(): void {
  notice = null;
}
