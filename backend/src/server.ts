import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
const port = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`backend listening on http://localhost:${port}`);
});
