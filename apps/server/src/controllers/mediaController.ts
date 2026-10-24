import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { randomUUID } from "node:crypto";
import { idSchema } from "@socialsync/shared";
import { HttpError } from "../lib/security.js";
import * as workspace from "../services/workspaceService.js";
import { projectId as pid } from "../lib/getProjectId.js";
import multer from "multer";
import { saveMediaUpload, uploadMimes } from "../services/mediaService.js";
export function mediaController(db: DB, config: Config) {
  const uploader = multer({
    storage: multer.diskStorage({
      destination: config.mediaDir,
      filename: (_req, _file, cb) => cb(null, randomUUID()),
    }),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!uploadMimes.includes(file.mimetype))
        cb(
          new HttpError(
            400,
            "Upload JPEG, PNG, WebP, GIF, MP4, MOV, or WebM media.",
          ),
        );
      else cb(null, true);
    },
  });
  const list: RequestHandler = (req, res) =>
    res.json(workspace.listMedia(db, pid(req)));
  const upload: RequestHandler = (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, "Choose a file to upload.");
    res.status(201).json(saveMediaUpload(db, pid(req), file));
  };
  const file: RequestHandler = (req, res) => {
    const media = workspace.getMedia(
      db,
      pid(req),
      idSchema.parse(req.params.mediaId),
    );
    res.type(media.mime);
    res.sendFile(media.id, { root: config.mediaDir });
  };
  const remove: RequestHandler = (req, res) => {
    workspace.deleteMedia(
      db,
      pid(req),
      idSchema.parse(req.params.mediaId),
      config.mediaDir,
    );
    res.json({ ok: true });
  };
  return { list, upload, file, remove, uploadFile: uploader.single("file") };
}
