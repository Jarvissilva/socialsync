import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { idSchema } from "@socialsync/shared";
import * as workspace from "../services/workspaceService.js";
import { projectId as pid } from "../lib/getProjectId.js";
export function postController(db: DB, _config: Config) {
  const list: RequestHandler = (req, res) =>
    res.json(workspace.listPosts(db, pid(req)));
  const create: RequestHandler = (req, res) =>
    res.status(201).json(workspace.savePost(db, pid(req), req.body));
  const read: RequestHandler = (req, res) =>
    res.json(
      workspace.getPost(db, pid(req), idSchema.parse(req.params.postId)),
    );
  const update: RequestHandler = (req, res) =>
    res.json(
      workspace.savePost(
        db,
        pid(req),
        req.body,
        idSchema.parse(req.params.postId),
      ),
    );
  const schedule: RequestHandler = (req, res) =>
    res.json(
      workspace.schedulePost(
        db,
        pid(req),
        idSchema.parse(req.params.postId),
        req.body,
      ),
    );
  const cancel: RequestHandler = (req, res) =>
    res.json(
      workspace.cancelPost(db, pid(req), idSchema.parse(req.params.postId)),
    );
  const retry: RequestHandler = (req, res) =>
    res.json(
      workspace.retryJob(
        db,
        pid(req),
        idSchema.parse(req.params.postId),
        idSchema.parse(req.params.jobId),
      ),
    );
  const resolve: RequestHandler = (req, res) =>
    res.json(
      workspace.resolveJob(
        db,
        pid(req),
        idSchema.parse(req.params.postId),
        idSchema.parse(req.params.jobId),
        req.body,
      ),
    );
  return { list, create, read, update, schedule, cancel, retry, resolve };
}
