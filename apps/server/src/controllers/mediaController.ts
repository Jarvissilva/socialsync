import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { randomUUID } from "node:crypto";
import { unlinkSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { idSchema } from "@social/shared";
import { HttpError } from "../lib/security.js";
import * as workspace from "../services/workspaceService.js";
import { projectId as pid } from "../lib/getProjectId.js";
import multer from "multer";
export function mediaController(db: DB, config: Config) {
  const uploader = multer({
    storage: multer.diskStorage({
      destination: config.mediaDir,
      filename: (_req, _file, cb) => cb(null, randomUUID()),
    }),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
          "video/mp4",
          "video/quicktime",
          "video/webm",
        ].includes(file.mimetype)
      )
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
    try {
      const fd = openSync(file.path, "r");
      const header = Buffer.alloc(16);
      try {
        readSync(fd, header, 0, 16, 0);
      } finally {
        closeSync(fd);
      }
      const detected =
        header[0] === 0xff && header[1] === 0xd8
          ? "image/jpeg"
          : header
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "image/png"
            : header.toString("ascii", 0, 4) === "RIFF" &&
                header.toString("ascii", 8, 12) === "WEBP"
              ? "image/webp"
              : /^GIF8[79]a/.test(header.toString("ascii", 0, 6))
                ? "image/gif"
                : header.toString("ascii", 4, 8) === "ftyp"
                  ? "video/mp4"
                  : header
                        .subarray(0, 4)
                        .equals(Buffer.from([26, 69, 223, 163]))
                    ? "video/webm"
                    : null;
      if (
        !detected ||
        (detected !== file.mimetype &&
          !(detected === "video/mp4" && file.mimetype === "video/quicktime"))
      )
        throw new HttpError(
          400,
          "The file contents do not match a supported media type.",
        );
      const media = {
        id: file.filename,
        projectId: pid(req),
        name: [...file.originalname]
          .filter((char) => char.charCodeAt(0) > 31)
          .join("")
          .slice(0, 200),
        mime: file.mimetype,
        size: file.size,
        createdAt: workspace.now(),
      };
      db.prepare("INSERT INTO media VALUES (?,?,?,?,?,?)").run(
        media.id,
        media.projectId,
        media.name,
        media.mime,
        media.size,
        media.createdAt,
      );
      res.status(201).json(media);
    } catch (error) {
      unlinkSync(file.path);
      throw error;
    }
  };
  const file: RequestHandler = (req, res) => {
    const media = workspace.getMedia(
      db,
      pid(req),
      idSchema.parse(req.params.mediaId),
    );
    res.type(media.mime);
    res.sendFile(join(config.mediaDir, media.id));
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
