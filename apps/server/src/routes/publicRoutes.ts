import { Router } from "express";
import type { DB } from "../database.js";
import type { Config } from "../config.js";
import { publicController } from "../controllers/publicController.js";
export function publicRouter(db: DB, config: Config) {
  const router = Router();
  const c = publicController(db, config);
  router.get("/media/:projectId/:mediaId", c.deliverMedia);
  router.get("/oauth/:platform/callback", c.oauthCallback);
  return router;
}
