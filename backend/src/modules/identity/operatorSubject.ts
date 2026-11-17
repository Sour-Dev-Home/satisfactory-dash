/** The single operator's FIXED account key (the `local` identity's subject). DASHBOARD_ADMIN_USER is
 *  only the display name, so renaming it never forks a second account (ADR-0025). Nobody signs in
 *  with this identity since gate B (ADR-0025 PR 9): it stays as the operator's anchor. */
export const OPERATOR_SUBJECT = "operator";
