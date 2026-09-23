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

const port = process.env.PORT ?? 3001;
const logger = createLogger();

function loadRegistryOrExit() {
  try {
    return loadServerRegistryFromEnv();
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
  loadRegistryOrExit().map(({ id, displayName, config }) => {
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

export const app = createApp({
  logger,
  routers: [
    healthRouter,
    createServersRouter(directory),
    createStatusRouter(directory),
    createFactoryRouter(directory),
    createPowerRouter(directory),
  ],
});

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    logger.info({ port }, "backend listening");
  });
}
