import { Navigate, useLocation } from "react-router";

/**
 * Sends any other path outside the app to /app (ADR-0021; / itself is the landing page, except
 * in the demo). Keeps the query string, which mock mode's ?scenario= and ?crash= read.
 */
export function ToApp() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app", search }} replace />;
}
