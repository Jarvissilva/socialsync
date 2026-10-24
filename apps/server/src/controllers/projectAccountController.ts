import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { z } from "zod";
import { idSchema } from "@socialsync/shared";
import * as workspace from "../services/workspaceService.js";
import { projectId as pid } from "../lib/getProjectId.js";
import { listPinterestBoards } from "../services/pinterestService.js";
export function projectAccountController(db: DB, config: Config) {
  const list: RequestHandler = (req, res) =>
    res.json(workspace.listAccounts(db, pid(req)));
  const assign: RequestHandler = (req, res) => {
    const body = z.object({ accountId: idSchema }).parse(req.body);
    workspace.assignAccount(db, pid(req), body.accountId);
    res.status(201).json({ ok: true });
  };
  const remove: RequestHandler = (req, res) => {
    workspace.removeAssignment(
      db,
      pid(req),
      idSchema.parse(req.params.accountId),
    );
    res.json({ ok: true });
  };
  const boards: RequestHandler = async (req, res) => {
    res.json(
      await listPinterestBoards(
        db,
        config,
        pid(req),
        idSchema.parse(req.params.accountId),
      ),
    );
  };
  return { list, assign, remove, boards };
}
