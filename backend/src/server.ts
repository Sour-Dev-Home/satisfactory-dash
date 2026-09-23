import "dotenv/config";
import { createApp } from "./app.js";
import { createLogger } from "./logger.js";
import { healthRouter } from "./routes/health.js";
import { createStatusRouter } from "./routes/status.js";
import { createFactoryRouter } from "./routes/factory.js";
import { createPowerRouter } from "./routes/power.js";
import { ConfigError, SatisfactoryServerAdapter, loadSatisfactoryServerConfigFromEnv } from "./adapters/index.js";
import { ServerStatusService } from "./services/serverStatusService.js";
import { ProductionService } from "./services/productionService.js";
import { PowerService } from "./services/powerService.js";

const port = process.env.PORT ?? 3001;
const logger = createLogger();

function loadConfigOrExit() {
  try {
    return loadSatisfactoryServerConfigFromEnv();
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.fatal(err.message);
      process.exit(1);
    }
    throw err;
  }
}

const adapter = SatisfactoryServerAdapter.fromConfig(loadConfigOrExit());

export const app = createApp({
  logger,
  routers: [
    healthRouter,
    createStatusRouter(new ServerStatusService(adapter)),
    createFactoryRouter(new ProductionService(adapter)),
    createPowerRouter(new PowerService(adapter)),
  ],
});

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    logger.info({ port }, "backend listening");
  });
}
