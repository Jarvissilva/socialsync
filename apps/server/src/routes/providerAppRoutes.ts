import { Router } from "express";
import { idSchema } from "@socialsync/shared";
import type { DB } from "../database.js";
import type { Config } from "../config.js";
import * as apps from "../services/providerAppService.js";

export function providerAppRouter(db: DB, config: Config) {
  const router = Router();
  router.get("/", (_req, res) => res.json(apps.listProviderApps(db, config)));
  router.post("/", (req, res) =>
    res.status(201).json(apps.createProviderApp(db, config, req.body)),
  );
  router.put("/:id", (req, res) =>
    res.json(
      apps.updateProviderApp(
        db,
        config,
        idSchema.parse(req.params.id),
        req.body,
      ),
    ),
  );
  router.delete("/:id", (req, res) => {
    apps.deleteProviderApp(db, idSchema.parse(req.params.id));
    res.json({ ok: true });
  });
  return router;
}
