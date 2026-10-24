import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DB } from "./database.js";
import type { Config } from "./config.js";
import { publicRouter } from "./routes/publicRoutes.js";
import { mcpRouter } from "./routes/mcpRoutes.js";
import { apiRouter } from "./routes/index.js";
import { requireLocal } from "./middleware/requireLocal.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { importProviderApps } from "./services/providerAppService.js";
export function createApp(db: DB, config: Config) {
  importProviderApps(db, config);
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use("/public", publicRouter(db, config));
  app.use(requireLocal(config));
  app.use("/mcp", mcpRouter(db, config));
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", apiRouter(db, config));
  const clientDir = fileURLToPath(
    new URL("../../client/dist", import.meta.url),
  );
  if (existsSync(join(clientDir, "index.html"))) {
    app.use(express.static(clientDir));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(join(clientDir, "index.html")),
    );
  }
  app.use(errorHandler);
  return app;
}
