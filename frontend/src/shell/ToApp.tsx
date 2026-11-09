import { Navigate, useLocation } from "react-router";

/**
 * Sends any other path outside the app to /app (ADR-0021; / itself is the landing page, except
 * in the demo). Keeps the query string, which mock mode's ?scenario= and ?crash= read.
 */
export function ToApp() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app", search }} replace />;
}

/**
 * The short address the mod prints on the server console ("sign in at https://satis-manager.com/pair", mod 0.3.0) opens
 * the pair page. The query string is dropped, never forwarded: ADR-0051 section 1 has nothing prefill the code, so a
 * `?code=` link can't ride through here either.
 */
export function ToPair() {
  return <Navigate to="/app/pair" replace />;
}

/** The old Alerts page's address (ADR-0027 PR 9a) now lands on the alert settings, same query string. */
export function ToAlertSettings() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app/settings", search, hash: "#alerts" }} replace />;
}
