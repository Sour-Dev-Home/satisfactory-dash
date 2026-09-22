import "dotenv/config";
import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.js";
import { createStatusRouter } from "./routes/status.js";
import { createFactoryRouter } from "./routes/factory.js";
import { createPowerRouter } from "./routes/power.js";
import { SatisfactoryServerAdapter, loadSatisfactoryServerConfigFromEnv } from "./adapters/index.js";
import { ServerStatusService } from "./services/serverStatusService.js";
import { ProductionService } from "./services/productionService.js";
import { PowerService } from "./services/powerService.js";

export const app = express();
const port = process.env.PORT ?? 3001;

const adapter = SatisfactoryServerAdapter.fromConfig(loadSatisfactoryServerConfigFromEnv());
const statusService = new ServerStatusService(adapter);
const productionService = new ProductionService(adapter);
const powerService = new PowerService(adapter);

app.use(cors());
app.use(express.json());
app.use("/api", healthRouter);
app.use("/api", createStatusRouter(statusService));
app.use("/api", createFactoryRouter(productionService));
app.use("/api", createPowerRouter(powerService));

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`backend listening on http://localhost:${port}`);
  });
}
