import type { RequestHandler } from "express";
import type { DB } from "../database.js";
import { requireProject as check } from "../services/workspaceService.js";
import { projectId } from "../lib/getProjectId.js";
export function requireProject(db: DB): RequestHandler {
  return (req, _res, next) => {
    check(db, projectId(req));
    next();
  };
}
