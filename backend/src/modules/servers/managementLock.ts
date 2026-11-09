/** The transaction-scoped advisory lock that serialises server writes across processes and instances: the self-serve
 *  create (its caps) and an account deletion's server checks take it. Moved here from the retired import CLI (ADR-0066). */
export const TAKE_SERVER_MANAGEMENT_LOCK = "SELECT pg_advisory_xact_lock(hashtext('satis.server_management'))";
