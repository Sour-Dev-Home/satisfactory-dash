import "dotenv/config";
import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.js";

export const app = express();
const port = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());
app.use("/api", healthRouter);

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`backend listening on http://localhost:${port}`);
  });
}
