import { Router } from "express";
import type { DB } from "../database.js";
import type { Config } from "../config.js";
import { accountController } from "../controllers/accountController.js";
export function accountRouter(db: DB, config: Config) {
  const router = Router();
  const c = accountController(db, config);
  router.get("/", c.list);
  router.post("/connect/:platform", c.connect);
  router.get("/discoveries/:id", c.discovery);
  router.post("/discoveries/:id", c.saveDiscovery);
  router.get("/:accountId/impact", c.impact);
  router.post("/:accountId/disconnect", c.disconnect);
  return router;
}
