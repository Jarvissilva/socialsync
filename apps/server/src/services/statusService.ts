import { z } from "zod";
import type { Config } from "../config.js";
import { one, type DB } from "../database.js";

export function workspaceStatus(db: DB, config: Config) {
  const heartbeat = one(
    db,
    z.object({ value: z.string() }),
    "SELECT value FROM runtime WHERE id='workerHeartbeat'",
  );
  return {
    ok: true,
    workerOnline: Boolean(
      heartbeat && Date.now() - Date.parse(heartbeat.value) < 30_000,
    ),
    publicMediaReady:
      config.mediaDelivery === "r2"
        ? Boolean(config.r2)
        : config.publicMediaOrigin.startsWith("https://"),
  };
}
