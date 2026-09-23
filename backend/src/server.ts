import "dotenv/config";
import { createApp } from "./app.js";
import { createLogger } from "./logger.js";
import { healthRouter } from "./routes/health.js";
import { createServersRouter } from "./routes/servers.js";
import { createStatusRouter } from "./routes/status.js";
import { createFactoryRouter } from "./routes/factory.js";
import { createPowerRouter } from "./routes/power.js";
import { ConfigError, SatisfactoryServerAdapter, loadServerRegistryFromEnv } from "./adapters/index.js";
import { ServerStatusService } from "./services/serverStatusService.js";
import { ProductionService } from "./services/productionService.js";
import { PowerService } from "./services/powerService.js";
import { InMemoryServerDirectory } from "./services/serverDirectory.js";
import { loadAuthConfigFromEnv } from "./services/auth/authConfig.js";
import { SingleOperatorAuthenticator } from "./services/auth/authenticator.js";
import { LoginRateLimiter } from "./services/auth/loginRateLimiter.js";
import { createAuthRouter } from "./routes/auth.js";
import { createSessionGuard } from "./routes/session.js";

const port = Number(process.env.PORT || 3001);
// ADR-0013: the backend is reached only through the Cloudflare Tunnel on this machine,
// so it listens on loopback by default. Binding anywhere else (e.g. 0.0.0.0 in a
// container) needs an explicit HOST (go-live blocker, issue #19).
const host = process.env.HOST?.trim() || "127.0.0.1";
const logger = createLogger();

/** A ConfigError means the backend must not start (e.g. a public game-server host, or
 *  missing login settings, ADR-0011): log it and exit instead of crashing. */
function orExit<T>(load: () => T): T {
  try {
    return load();
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.fatal(err.message);
      process.exit(1);
    }
    throw err;
  }
}

// ADR-0001: one adapter and one set of services per registered game server.
const directory = new InMemoryServerDirectory(
  orExit(() => loadServerRegistryFromEnv()).map(({ id, displayName, config }) => {
    const adapter = SatisfactoryServerAdapter.fromConfig(config);
    return {
      id,
      displayName,
      services: {
        status: new ServerStatusService(adapter),
        production: new ProductionService(adapter),
        power: new PowerService(adapter),
      },
    };
  }),
);

// ADR-0011: every /api route except health and the auth endpoints needs a session.
const auth = orExit(() => loadAuthConfigFromEnv());
const sessionDeps = {
  authenticator: new SingleOperatorAuthenticator(auth.adminUser, auth.passwordHash),
  sessionSecret: auth.sessionSecret,
};

export const app = createApp({
  logger,
  allowedOrigins: auth.allowedOrigins,
  routers: [healthRouter, createAuthRouter({ ...sessionDeps, rateLimiter: new LoginRateLimiter() })],
  sessionGuard: createSessionGuard(sessionDeps),
  protectedRouters: [
    createServersRouter(directory),
    createStatusRouter(directory),
    createFactoryRouter(directory),
    createPowerRouter(directory),
  ],
});

if (process.env.NODE_ENV !== "test") {
  app.listen(port, host, () => {
    logger.info({ host, port }, `backend listening on ${host}:${port}`);
  });
}
