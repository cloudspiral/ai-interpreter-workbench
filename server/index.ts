import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerCascadeSocket } from "./cascadeSocket.js";
import { loadConfig, publicRuntimeConfig } from "./config.js";
import { registerRealtimeRoute } from "./realtimeRoute.js";

const app = express();
const server = createServer(app);
const config = loadConfig();
const currentDir = dirname(fileURLToPath(import.meta.url));
const clientDir = join(currentDir, "../../dist");

app.disable("x-powered-by");
app.use(express.text({ type: ["application/sdp", "text/plain"], limit: "256kb" }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    ...publicRuntimeConfig(config),
  });
});

registerRealtimeRoute(app, config);
registerCascadeSocket(server, config);

if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.use((_request, response) => {
    response.sendFile(join(clientDir, "index.html"));
  });
}

server.listen(config.port, "0.0.0.0", () => {
  console.log(`AI Interpreter Workbench listening on port ${config.port}`);
});
