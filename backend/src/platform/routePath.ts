/** The routers are mounted under /api (app.ts), so a shared endpoint's route pattern
 *  (e.g. "/api/servers/:serverId/power") is registered without that prefix. Using the
 *  contract's own pattern keeps the backend and the frontend's path builders in step. */
export function routePath(route: string): string {
  return route.replace(/^\/api(?=\/)/, "");
}
