import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { idSchema, type Media } from "@socialsync/shared";
import type { Config } from "../config.js";
import { signature } from "../lib/security.js";
import { ProviderError } from "./providerHttp.js";

import { mediaPath, type MediaVariant } from "./instagramMediaService.js";

const urlLifetime = 24 * 60 * 60;
const refreshAge = 5 * 24 * 60 * 60 * 1000;
const clients = new WeakMap<Config, S3Client>();

export async function mediaUrl(
  config: Config,
  media: Media,
  variant?: MediaVariant,
): Promise<string> {
  if (config.mediaDelivery === "local") {
    if (!config.publicMediaOrigin.startsWith("https://"))
      throw new ProviderError(
        "Configure R2 media delivery or set PUBLIC_MEDIA_ORIGIN to your active HTTPS tunnel before publishing media.",
      );
    const expires = String(Date.now() + urlLifetime * 1000);
    const value = `${media.projectId}:${media.id}:${expires}${variant ? `:${variant}` : ""}`;
    return `${config.publicMediaOrigin}/public/media/${media.projectId}/${media.id}?expires=${expires}${variant ? `&variant=${variant}` : ""}&signature=${signature(value, config.encryptionKey)}`;
  }
  try {
    const r2 = config.r2;
    if (!r2) throw new Error("R2 configuration missing.");
    // IDs come from project-scoped database lookups. Validate again before using
    // them as local paths or remote key segments.
    idSchema.parse(media.id);
    idSchema.parse(media.projectId);
    let client = clients.get(config);
    if (!client) {
      client = new S3Client({
        endpoint: r2.endpoint,
        region: "auto",
        credentials: {
          accessKeyId: r2.accessKeyId,
          secretAccessKey: r2.secretAccessKey,
        },
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
      clients.set(config, client);
    }
    const object = {
      Bucket: r2.bucket,
      Key: `${r2.keyPrefix}/${media.projectId}/${media.id}${variant ? `/${variant}.jpg` : ""}`,
    };
    const file = await open(
      mediaPath(config.mediaDir, media, variant),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (!variant && stat.size !== media.size))
        throw new Error("Local media changed.");
      const size = stat.size;
      const mime = variant ? "image/jpeg" : media.mime;
      const metadata = {
        size: String(stat.size),
        mtime: String(stat.mtimeMs),
        ctime: String(stat.ctimeMs),
      };
      let head;
      try {
        head = await client.send(new HeadObjectCommand(object), {
          abortSignal: AbortSignal.timeout(120_000),
        });
      } catch (error) {
        // Permission failures and missing buckets must never be treated as a
        // missing object (or trigger fallback to local tunnel delivery).
        if (!(error instanceof Error && error.name === "NotFound")) throw error;
      }
      if (
        !head ||
        head.ContentLength !== size ||
        head.ContentType !== mime ||
        Object.entries(metadata).some(
          ([key, value]) => head.Metadata?.[key] !== value,
        ) ||
        !head.LastModified ||
        Date.now() - head.LastModified.getTime() >= refreshAge
      ) {
        const body = file.createReadStream({ autoClose: false });
        try {
          await client.send(
            new PutObjectCommand({
              ...object,
              Body: body,
              ContentLength: size,
              ContentType: mime,
              Metadata: metadata,
            }),
            { abortSignal: AbortSignal.timeout(600_000) },
          );
        } finally {
          body.destroy();
        }
      }
      return await getSignedUrl(client, new GetObjectCommand(object), {
        expiresIn: urlLifetime,
      });
    } finally {
      await file.close();
    }
  } catch {
    // SDK errors can include request URLs and credentials. Do not persist their
    // messages, causes, or signed URLs in job errors or publishing checkpoints.
    throw new ProviderError(
      "R2 media preparation failed. Check server configuration, bucket access, and the local media file, then retry.",
      true,
    );
  }
}
