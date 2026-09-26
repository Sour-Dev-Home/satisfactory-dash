import { Navigate, useLocation } from "react-router";

/**
 * Sends any other path outside the app to /app (ADR-0021; / itself is the landing page, except
 * in the demo). Keeps the query string, which mock mode's ?scenario= and ?crash= read.
 */
export function ToApp() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app", search }} replace />;
}

/** The old Alerts page's address (ADR-0027 PR 9a) now lands on the alert settings, same query string. */
export function ToAlertSettings() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app/settings", search, hash: "#alerts" }} replace />;
}
