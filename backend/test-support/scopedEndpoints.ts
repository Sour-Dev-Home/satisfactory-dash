export type Method = "GET" | "PUT" | "POST" | "PATCH" | "DELETE";

export interface ScopedEndpoint {
  name: string;
  method: Method;
  route: string;
  /** ADR-0030: the contract marks the endpoint `operatorOnly`, so an owner or admin who is not the operator is refused (403). */
  operatorOnly: boolean;
}

/** A route under a server: `/servers/:serverId` itself or anything below it, but not
 *  `/servers/:serverIdentity` or the bare `/servers` list. */
const SERVER_SCOPED = /\/servers\/:serverId(\/|$)/;

/**
 * Every endpoint whose route is server-scoped, found by walking the (nested) shared contract.
 * The IDOR tests are generated from this, so it must select the bare `/api/servers/:serverId`
 * shape (a future DELETE or PATCH of the server itself) as well as the sub-resources.
 */
export function scopedEndpoints(node: unknown, path: string[] = []): ScopedEndpoint[] {
  if (typeof node !== "object" || node === null) {
    return [];
  }
  const entry = node as { method?: Method; route?: string; operatorOnly?: boolean };
  if (typeof entry.route === "string" && entry.method) {
    return SERVER_SCOPED.test(entry.route)
      ? [{ name: path.join("."), method: entry.method, route: entry.route, operatorOnly: entry.operatorOnly === true }]
      : [];
  }
  return Object.entries(node).flatMap(([key, value]) => scopedEndpoints(value, [...path, key]));
}
