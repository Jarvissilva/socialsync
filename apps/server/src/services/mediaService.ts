import { randomUUID } from "node:crypto";
import {
  constants,
  createWriteStream,
  openSync,
  readSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { open, realpath, rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Media } from "@socialsync/shared";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { HttpError } from "../lib/security.js";
import { now, requireProject } from "./workspaceService.js";

export const uploadMimes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

function detectMime(header: Buffer) {
  return header[0] === 0xff && header[1] === 0xd8
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
            : header.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
              ? "video/webm"
              : null;
}

interface Upload {
  path: string;
  filename: string;
  originalname: string;
  mimetype?: string;
  size: number;
}

// Both HTTP uploads and MCP imports use the same content checks and records.
export function saveMediaUpload(
  db: DB,
  projectId: string,
  file: Upload,
): Media {
  try {
    requireProject(db, projectId);
    const fd = openSync(file.path, "r");
    const header = Buffer.alloc(16);
    try {
      readSync(fd, header, 0, 16, 0);
    } finally {
      closeSync(fd);
    }
    const detected = detectMime(header);
    if (
      !detected ||
      (file.mimetype &&
        detected !== file.mimetype &&
        !(detected === "video/mp4" && file.mimetype === "video/quicktime"))
    )
      throw new HttpError(
        400,
        "The file contents do not match a supported media type.",
      );
    const media: Media = {
      id: file.filename,
      projectId,
      name: [...file.originalname]
        .filter((char) => char.charCodeAt(0) > 31)
        .join("")
        .slice(0, 200),
      mime: file.mimetype || detected,
      size: file.size,
      createdAt: now(),
    };
    db.prepare("INSERT INTO media VALUES (?,?,?,?,?,?)").run(
      media.id,
      media.projectId,
      media.name,
      media.mime,
      media.size,
      media.createdAt,
    );
    return media;
  } catch (error) {
    unlinkSync(file.path);
    throw error;
  }
}

export async function importMedia(
  db: DB,
  config: Config,
  projectId: string,
  path: string,
): Promise<Media> {
  requireProject(db, projectId);
  if (!isAbsolute(path))
    throw new HttpError(400, "Choose an absolute path to a local media file.");
  const sourcePath = await realpath(path);
  const managedPath = relative(await realpath(config.mediaDir), sourcePath);
  if (
    !managedPath ||
    (!isAbsolute(managedPath) &&
      managedPath !== ".." &&
      !managedPath.startsWith(`..${sep}`))
  )
    throw new HttpError(
      400,
      "Choose a source file outside SocialSync’s managed media directory. Use this project's media IDs for existing uploads.",
    );
  const source = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  const filename = randomUUID();
  const destination = join(config.mediaDir, filename);
  try {
    const stat = await source.stat();
    if (!stat.isFile())
      throw new HttpError(400, "Choose a regular local media file.");
    if (stat.size > config.maxUploadBytes)
      throw new HttpError(400, "This file exceeds MAX_UPLOAD_BYTES.");
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(
          size > config.maxUploadBytes
            ? new HttpError(400, "This file exceeds MAX_UPLOAD_BYTES.")
            : null,
          chunk,
        );
      },
    });
    await pipeline(
      source.createReadStream({ autoClose: false }),
      limit,
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    );
    return saveMediaUpload(db, projectId, {
      path: destination,
      filename,
      originalname: basename(path),
      size,
    });
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  } finally {
    await source.close();
  }
}
