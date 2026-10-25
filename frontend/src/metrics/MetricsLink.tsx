import { Link } from "react-router";

/**
 * ADR-0056 section 3: the Servers page's link to the metrics page, one of its two doors (the other is the command
 * bar), since the real nav doesn't list it. Rendered only on the operator's Servers page.
 */
export function MetricsLink() {
  return (
    <p className="mb-0 text-sm text-muted">
      Looking for system health or alert quality? <Link to="/app/metrics">Open the metrics page</Link>.
    </p>
  );
}
