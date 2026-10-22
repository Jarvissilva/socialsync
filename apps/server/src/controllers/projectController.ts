import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { idSchema } from "@social/shared";
import * as workspace from "../services/workspaceService.js";
export function projectController(db: DB, _config: Config) {
  const list: RequestHandler = (_req, res) =>
    res.json(workspace.listProjects(db));
  const create: RequestHandler = (req, res) =>
    res.status(201).json(workspace.saveProject(db, req.body));
  const update: RequestHandler = (req, res) =>
    res.json(
      workspace.saveProject(db, req.body, idSchema.parse(req.params.projectId)),
    );
  return { list, create, update };
}
