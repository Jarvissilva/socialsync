import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { idSchema, type Media } from "@socialsync/shared";
import type { Config } from "../config.js";
import { ProviderError } from "./providerHttp.js";

export const instagramVariant = "instagram-jpeg-v1";
export type MediaVariant = typeof instagramVariant;

export function variantDirectory(
  mediaDir: string,
  media: Pick<Media, "projectId" | "id">,
) {
  idSchema.parse(media.projectId);
  idSchema.parse(media.id);
  return join(mediaDir, "variants", media.projectId, media.id);
}

export function mediaPath(
  mediaDir: string,
  media: Media,
  variant?: MediaVariant,
) {
  idSchema.parse(media.projectId);
  idSchema.parse(media.id);
  return variant
    ? join(variantDirectory(mediaDir, media), variant, "image.jpg")
    : join(mediaDir, media.id);
}

// libvips may expose APNG as a single PNG. Check its animation control chunk
// explicitly instead of accidentally publishing only the default image.
function animatedPng(bytes: Buffer) {
  if (bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") return false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL") return true;
    offset += bytes.readUInt32BE(offset) + 12;
  }
  return false;
}

export async function prepareInstagramMedia(
  config: Config,
  media: Media,
): Promise<MediaVariant | undefined> {
  if (media.mime === "image/jpeg" || media.mime.startsWith("video/")) return;
  if (!["image/png", "image/webp", "image/gif"].includes(media.mime))
    throw new ProviderError(
      "Instagram supports JPEG, PNG, WebP, or still GIF images.",
    );
  let temporary: string | undefined;
  try {
    const destination = mediaPath(config.mediaDir, media, instagramVariant);
    try {
      if ((await stat(destination)).isFile()) return instagramVariant;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    const file = await open(
      mediaPath(config.mediaDir, media),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let bytes: Buffer;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size !== media.size)
        throw new Error("Invalid source.");
      bytes = await file.readFile();
    } finally {
      await file.close();
    }
    const image = sharp(bytes, { failOn: "warning" });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1 || animatedPng(bytes))
      throw new ProviderError(
        "Animated images aren’t supported for Instagram. Choose a still image.",
      );
    if (!metadata.format || !["png", "webp", "gif"].includes(metadata.format))
      throw new Error("Unsupported contents.");
    await mkdir(dirname(destination), { recursive: true });
    temporary = `${destination}.${randomUUID()}.tmp`;
    await image
      .rotate()
      .toColourspace("srgb")
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90 })
      .toFile(temporary);
    await rename(temporary, destination);
    return instagramVariant;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      "Instagram image preparation failed. Choose a valid PNG, WebP, or still GIF image and try again.",
    );
  } finally {
    if (temporary) await rm(temporary, { force: true }).catch(() => {});
  }
}
