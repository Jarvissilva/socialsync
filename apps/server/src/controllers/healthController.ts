import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { z } from "zod";
import { one } from "../database.js";
import * as accounts from "../services/accountService.js";
export function healthController(db: DB, config: Config) {
  const health: RequestHandler = (_req, res) => {
    const heartbeat = one(
      db,
      z.object({ value: z.string() }),
      "SELECT value FROM runtime WHERE id='workerHeartbeat'",
    );
    res.json({
      ok: true,
      workerOnline: Boolean(
        heartbeat && Date.now() - Date.parse(heartbeat.value) < 30_000,
      ),
      publicMediaReady: config.publicMediaOrigin.startsWith("https://"),
    });
  };
  const providers: RequestHandler = (_req, res) =>
    res.json(accounts.providerStatuses());
  return { health, providers };
}
