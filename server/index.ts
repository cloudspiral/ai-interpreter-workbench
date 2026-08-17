import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT ?? 3001);
const currentDir = dirname(fileURLToPath(import.meta.url));
const clientDir = join(currentDir, "../../dist");

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
});

if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.use((_request, response) => {
    response.sendFile(join(clientDir, "index.html"));
  });
}

server.listen(port, "0.0.0.0", () => {
  console.log(`AI Interpreter Workbench listening on port ${port}`);
});

