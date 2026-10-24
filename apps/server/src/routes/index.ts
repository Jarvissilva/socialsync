import { Router } from "express";
import type { DB } from "../database.js";
import type { Config } from "../config.js";
import { HttpError } from "../lib/security.js";
import { projectRouter } from "./projectRoutes.js";
import { accountRouter } from "./accountRoutes.js";
import { healthController } from "../controllers/healthController.js";
import { projectController } from "../controllers/projectController.js";
import { providerAppRouter } from "./providerAppRoutes.js";
export function apiRouter(db: DB, config: Config) {
  const router = Router();
  {
    const c = healthController(db, config);
    router.get("/health", c.health);
    router.get("/providers", c.providers);
  }
  {
    const c = projectController(db, config);
    router.get("/projects", c.list);
    router.post("/projects", c.create);
    router.put("/projects/:projectId", c.update);
  }
  router.use("/provider-apps", providerAppRouter(db, config));
  router.use("/accounts", accountRouter(db, config));
  router.use("/projects/:projectId", projectRouter(db, config));
  router.use(() => {
    throw new HttpError(404, "API endpoint not found.");
  });
  return router;
}
