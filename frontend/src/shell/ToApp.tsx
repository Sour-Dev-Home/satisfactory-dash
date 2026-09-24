import { Navigate, useLocation } from "react-router";

/**
 * Sends any path outside the app to /app (ADR-0021 keeps / free for public pages later; for
 * now it just redirects). Keeps the query string, which mock mode's ?scenario= and
 * ?crash= read.
 */
export function ToApp() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app", search }} replace />;
}
