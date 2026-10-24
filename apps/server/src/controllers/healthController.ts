import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import * as accounts from "../services/accountService.js";
import { workspaceStatus } from "../services/statusService.js";
export function healthController(db: DB, config: Config) {
  const health: RequestHandler = (_req, res) => {
    res.json(workspaceStatus(db, config));
  };
  const providers: RequestHandler = (_req, res) =>
    res.json(accounts.providerStatuses(db));
  return { health, providers };
}
