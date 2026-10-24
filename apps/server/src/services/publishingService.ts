import { openAsBlob } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Media, TargetInput } from "@socialsync/shared";
import type { Config } from "../config.js";
import { accountRowSchema } from "../database.js";
import { prepareInstagramMedia } from "./instagramMediaService.js";
import { mediaUrl } from "./mediaDeliveryService.js";
export { mediaUrl } from "./mediaDeliveryService.js";
import type { Tokens } from "./accountService.js";
import { request, ProviderError, remoteIdSchema } from "./providerHttp.js";

export const checkpointSchema = z.object({
  stage: z.string().optional(),
  containerId: z.string().optional(),
  children: z.array(z.string()).optional(),
  mediaId: z.string().optional(),
  uploadUrl: z.string().optional(),
  transferred: z.boolean().optional(),
  offset: z.number().optional(),
  remoteId: z.string().optional(),
  url: z.string().optional(),
  uploadParameters: z.record(z.string(), z.string()).optional(),
  pollCount: z.number().optional(),
  retryCount: z.number().optional(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
export interface PublishContext {
  config: Config;
  account: z.infer<typeof accountRowSchema>;
  tokens: Tokens;
  target: TargetInput;
  caption: string;
  media: Media[];
  checkpoint: Checkpoint;
  save: (value: Checkpoint) => void;
}
export interface PublishResult {
  pending: boolean;
  remoteId?: string;
  url?: string;
}
function trustedUploadUrl(value: string, hosts: string[]) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !hosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  )
    throw new ProviderError(
      "The platform returned an unexpected upload endpoint.",
    );
  return url.toString();
}
export async function publish(ctx: PublishContext): Promise<PublishResult> {
  const cp = ctx.checkpoint;
  const save = (updates: Checkpoint) => {
    Object.assign(cp, updates);
    ctx.save(cp);
  };
  if (cp.stage === "done" && cp.remoteId)
    return { pending: false, remoteId: cp.remoteId, url: cp.url };
  switch (ctx.account.platform) {
    case "instagram":
      return instagram(ctx, save);
    case "facebook":
      return facebook(ctx, save);
    case "pinterest":
      return pinterest(ctx, save);
    case "youtube":
      return youtube(ctx, save);
  }
}
async function instagram(
  ctx: PublishContext,
  save: (cp: Checkpoint) => void,
): Promise<PublishResult> {
  const { config, account, tokens, target, media, checkpoint: cp } = ctx;
  const facebookLogin = tokens.instagramLogin === "facebook";
  const token = facebookLogin
    ? tokens.accountTokens[account.externalId]
    : tokens.accessToken;
  if (!token)
    throw new ProviderError(
      "Missing Page authorization. Reconnect this account.",
    );
  const base = `https://${facebookLogin ? "graph.facebook.com" : "graph.instagram.com"}/${config.graphVersion}`;
  const headers = { Authorization: `Bearer ${token}` };
  const post = (path: string, params: Record<string, string>) =>
    request(
      `${base}/${path}`,
      { method: "POST", headers, body: new URLSearchParams(params) },
      true,
    );
  const caption = target.caption || ctx.caption;
  const status = async (id: string) =>
    z
      .object({ status_code: z.string() })
      .parse(await request(`${base}/${id}?fields=status_code`, { headers }))
      .status_code;
  if (!cp.containerId) {
    const params: Record<string, string> = { caption };
    if (target.format === "carousel") {
      const children = cp.children || [];
      const prepared: { item: Media; url: string }[] = [];
      for (let i = children.length; i < media.length; i++) {
        const item = media[i];
        if (item)
          prepared.push({
            item,
            url: await mediaUrl(
              config,
              item,
              await prepareInstagramMedia(config, item),
            ),
          });
      }
      for (const { item, url } of prepared) {
        const child: Record<string, string> = { is_carousel_item: "true" };
        if (item.mime.startsWith("video/")) {
          child.media_type = "VIDEO";
          child.video_url = url;
        } else child.image_url = url;
        children.push(
          remoteIdSchema.parse(await post(`${account.externalId}/media`, child))
            .id,
        );
        save({ children });
      }
      for (const id of children) {
        const value = await status(id);
        if (["ERROR", "EXPIRED"].includes(value))
          throw new ProviderError(
            "Instagram could not process a carousel item. Check media requirements.",
          );
        if (value !== "FINISHED") return { pending: true };
      }
      params.media_type = "CAROUSEL";
      params.children = children.join(",");
    } else {
      const item = media[0];
      if (!item) throw new ProviderError("Media is missing.");
      if (item.mime.startsWith("video/"))
        params.video_url = await mediaUrl(config, item);
      else
        params.image_url = await mediaUrl(
          config,
          item,
          await prepareInstagramMedia(config, item),
        );
      if (target.format === "reel") params.media_type = "REELS";
      if (target.format === "story") {
        params.media_type = "STORIES";
        delete params.caption;
      }
    }
    save({
      containerId: remoteIdSchema.parse(
        await post(`${account.externalId}/media`, params),
      ).id,
      stage: "processing",
    });
  }
  const container = cp.containerId;
  if (!container) throw new ProviderError("Missing Instagram container.");
  const value = await status(container);
  if (value === "PUBLISHED") {
    save({ stage: "done", remoteId: cp.remoteId || container });
    return { pending: false, remoteId: cp.remoteId || container, url: cp.url };
  }
  if (["ERROR", "EXPIRED"].includes(value))
    throw new ProviderError(
      "Instagram media processing failed or expired. Duplicate the post after correcting its media.",
    );
  if (value !== "FINISHED") return { pending: true };
  if (cp.stage === "publishing")
    throw new ProviderError(
      "Instagram publication is awaiting reconciliation. Check the account before creating another post.",
      false,
      true,
    );
  save({ stage: "publishing" });
  const result = remoteIdSchema.parse(
    await post(`${account.externalId}/media_publish`, {
      creation_id: container,
    }),
  );
  save({ remoteId: result.id, stage: "done" });
  try {
    const detail = z
      .object({ permalink: z.string().optional() })
      .parse(
        await request(`${base}/${result.id}?fields=permalink`, { headers }),
      );
    save({ url: detail.permalink });
  } catch {
    /* Publication is already confirmed; permalink lookup must not trigger a resend. */
  }
  return { pending: false, remoteId: result.id, url: cp.url };
}
async function facebook(
  ctx: PublishContext,
  save: (cp: Checkpoint) => void,
): Promise<PublishResult> {
  const { config, account, tokens, target, media, checkpoint: cp } = ctx;
  const token = tokens.accountTokens[account.externalId];
  if (!token)
    throw new ProviderError(
      "Reconnect Facebook to obtain a Page access token.",
    );
  const headers = { Authorization: `Bearer ${token}` };
  const base = `https://graph.facebook.com/${config.graphVersion}`;
  const post = (path: string, params: Record<string, string>) =>
    request(
      `${base}/${path}`,
      { method: "POST", headers, body: new URLSearchParams(params) },
      true,
    );
  const caption = target.caption || ctx.caption;
  const item = media[0];
  const isVideo = item?.mime.startsWith("video/");
  if (cp.stage === "publishing" && !cp.remoteId)
    throw new ProviderError(
      "The Facebook publication outcome is uncertain. Check the Page before posting again.",
      false,
      true,
    );
  if (target.format === "reel" || (target.format === "story" && isVideo)) {
    if (!item) throw new ProviderError("Select a video.");
    const edge = target.format === "reel" ? "video_reels" : "video_stories";
    if (!cp.mediaId) {
      const r = z
        .object({
          video_id: z.union([z.string(), z.number()]).transform(String),
          upload_url: z.string(),
        })
        .parse(
          await post(`${account.externalId}/${edge}`, {
            upload_phase: "start",
          }),
        );
      save({
        mediaId: r.video_id,
        uploadUrl: trustedUploadUrl(r.upload_url, ["rupload.facebook.com"]),
        stage: "uploading",
      });
    }
    if (!cp.transferred) {
      await request(
        cp.uploadUrl || "",
        {
          method: "POST",
          headers: {
            Authorization: `OAuth ${token}`,
            file_url: await mediaUrl(config, item),
          },
        },
        true,
      );
      save({ transferred: true });
    }
    if (cp.stage !== "processing") {
      save({ stage: "publishing" });
      const params: Record<string, string> = {
        upload_phase: "finish",
        video_id: cp.mediaId || "",
      };
      if (target.format === "reel") {
        params.video_state = "PUBLISHED";
        params.description = caption;
      }
      await post(`${account.externalId}/${edge}`, params);
      save({ stage: "processing", remoteId: cp.mediaId });
    }
  } else if (!cp.remoteId) {
    let result: unknown;
    if (target.format === "text") {
      save({ stage: "publishing" });
      result = await post(`${account.externalId}/feed`, {
        message: caption,
        ...(target.link ? { link: target.link } : {}),
      });
    } else if (
      target.format === "carousel" ||
      (target.format === "story" && !isVideo)
    ) {
      const children = cp.children || [];
      for (let i = children.length; i < media.length; i++) {
        const m = media[i];
        if (!m) continue;
        children.push(
          remoteIdSchema.parse(
            await post(`${account.externalId}/photos`, {
              url: await mediaUrl(config, m),
              published: "false",
            }),
          ).id,
        );
        save({ children });
      }
      save({ stage: "publishing" });
      if (target.format === "story")
        result = await post(`${account.externalId}/photo_stories`, {
          photo_id: children[0] || "",
        });
      else {
        const params: Record<string, string> = { message: caption };
        children.forEach((id, i) => {
          params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
        });
        result = await post(`${account.externalId}/feed`, params);
      }
    } else {
      if (!item) throw new ProviderError("Select media.");
      const url = await mediaUrl(config, item);
      save({ stage: "publishing" });
      result = await post(
        `${account.externalId}/${isVideo ? "videos" : "photos"}`,
        isVideo
          ? {
              file_url: url,
              description: caption,
              title: target.title,
            }
          : { url, caption, published: "true" },
      );
    }
    const r = z
      .object({
        id: z.union([z.string(), z.number()]).transform(String).optional(),
        post_id: z.string().optional(),
        success: z.boolean().optional(),
      })
      .parse(result);
    const id = r.post_id || r.id || (r.success ? cp.children?.[0] : undefined);
    if (!id)
      throw new ProviderError(
        "Facebook returned no publication identifier. Check the Page.",
        false,
        true,
      );
    save({ remoteId: id, stage: isVideo ? "processing" : "done" });
  }
  const id = cp.remoteId;
  if (!id) return { pending: true };
  if (cp.stage === "processing") {
    const r = z
      .object({
        status: z
          .object({
            video_status: z.string().optional(),
            publishing_phase: z
              .object({ status: z.string().optional() })
              .optional(),
          })
          .optional(),
      })
      .parse(await request(`${base}/${id}?fields=status`, { headers }));
    if (r.status?.video_status === "error")
      throw new ProviderError("Facebook video processing failed.");
    if (
      r.status?.video_status !== "ready" ||
      (r.status.publishing_phase?.status &&
        r.status.publishing_phase.status !== "complete")
    )
      return { pending: true };
  }
  const url = `https://www.facebook.com/${id}`;
  save({ stage: "done", url });
  return { pending: false, remoteId: id, url };
}
async function pinterest(
  ctx: PublishContext,
  save: (cp: Checkpoint) => void,
): Promise<PublishResult> {
  const { config, tokens, target, media, checkpoint: cp } = ctx;
  const headers = { Authorization: `Bearer ${tokens.accessToken}` };
  const item = media[0];
  if (!item) throw new ProviderError("Select media.");
  const video = item.mime.startsWith("video/");
  if (video && !cp.mediaId) {
    const r = z
      .object({
        media_id: z.string(),
        upload_url: z.string(),
        upload_parameters: z.record(z.string(), z.string()),
      })
      .parse(
        await request(
          "https://api.pinterest.com/v5/media",
          {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ media_type: "video" }),
          },
          true,
        ),
      );
    save({
      mediaId: r.media_id,
      uploadUrl: trustedUploadUrl(r.upload_url, [
        "amazonaws.com",
        "pinterest.com",
        "pinimg.com",
      ]),
      uploadParameters: r.upload_parameters,
    });
  }
  if (video && !cp.transferred) {
    const body = new FormData();
    for (const [k, v] of Object.entries(cp.uploadParameters || {}))
      body.set(k, v);
    body.set(
      "file",
      await openAsBlob(join(config.mediaDir, item.id), { type: item.mime }),
      item.name,
    );
    let response: Response;
    try {
      response = await fetch(cp.uploadUrl || "", {
        method: "POST",
        body,
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new ProviderError("Pinterest media upload was interrupted.", true);
    }
    if (!response.ok)
      throw new ProviderError("Pinterest media upload failed.", true);
    save({ transferred: true });
  }
  if (video) {
    const r = z.object({ status: z.string() }).parse(
      await request(`https://api.pinterest.com/v5/media/${cp.mediaId}`, {
        headers,
      }),
    );
    if (r.status === "failed")
      throw new ProviderError("Pinterest could not process this video.");
    if (r.status !== "succeeded") return { pending: true };
  }
  if (cp.stage === "publishing")
    throw new ProviderError(
      "The Pin publication outcome is uncertain. Check Pinterest before creating another Pin.",
      false,
      true,
    );
  const imageUrl = video ? undefined : await mediaUrl(config, item);
  save({ stage: "publishing" });
  const r = remoteIdSchema.parse(
    await request(
      "https://api.pinterest.com/v5/pins",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          board_id: target.boardId,
          title: target.title,
          description: target.caption || ctx.caption,
          ...(target.link ? { link: target.link } : {}),
          media_source: video
            ? {
                source_type: "video_id",
                media_id: cp.mediaId,
                cover_image_key_frame_time: 0,
              }
            : { source_type: "image_url", url: imageUrl },
        }),
      },
      true,
    ),
  );
  const url = `https://www.pinterest.com/pin/${r.id}/`;
  save({ stage: "done", remoteId: r.id, url });
  return { pending: false, remoteId: r.id, url };
}
async function youtube(
  ctx: PublishContext,
  save: (cp: Checkpoint) => void,
): Promise<PublishResult> {
  const { config, tokens, target, media, checkpoint: cp } = ctx;
  const item = media[0];
  if (!item) throw new ProviderError("Select a video.");
  const headers = { Authorization: `Bearer ${tokens.accessToken}` };
  if (!cp.uploadUrl) {
    let r: Response;
    try {
      r = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "X-Upload-Content-Length": String(item.size),
            "X-Upload-Content-Type": item.mime,
          },
          body: JSON.stringify({
            snippet: {
              title: target.title,
              description: target.caption || ctx.caption,
              categoryId: "22",
            },
            status: {
              privacyStatus: target.privacy,
              selfDeclaredMadeForKids: target.madeForKids,
            },
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      throw new ProviderError("YouTube upload initialization failed.", true);
    }
    if (!r.ok)
      throw new ProviderError(
        `YouTube upload initialization failed (HTTP ${r.status}).`,
        r.status === 429 || r.status >= 500,
        false,
        [401, 403].includes(r.status),
      );
    const location = r.headers.get("location");
    if (!location)
      throw new ProviderError("YouTube returned no resumable upload session.");
    save({
      uploadUrl: trustedUploadUrl(location, ["googleapis.com"]),
      offset: 0,
      stage: "uploading",
    });
  }
  if (!cp.remoteId) {
    const url = cp.uploadUrl || "";
    let offset = cp.offset || 0;
    // Always query the session before sending bytes; a previous response may have been lost.
    let probe: Response;
    try {
      probe = await fetch(url, {
        method: "PUT",
        headers: {
          ...headers,
          "Content-Length": "0",
          "Content-Range": `bytes */${item.size}`,
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ProviderError(
        "Could not query the YouTube upload session.",
        true,
      );
    }
    if (probe.ok) {
      const r = remoteIdSchema.parse(await probe.json());
      save({ remoteId: r.id, stage: "processing" });
    } else if (probe.status === 308) {
      const range = probe.headers.get("range");
      offset = range ? Number(range.split("-")[1]) + 1 : 0;
      const end = Math.min(offset + 8 * 1024 * 1024, item.size);
      const blob = await openAsBlob(join(config.mediaDir, item.id), {
        type: item.mime,
      });
      let r: Response;
      try {
        r = await fetch(url, {
          method: "PUT",
          headers: {
            ...headers,
            "Content-Type": item.mime,
            "Content-Length": String(end - offset),
            "Content-Range": `bytes ${offset}-${end - 1}/${item.size}`,
          },
          body: blob.slice(offset, end),
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        throw new ProviderError(
          "YouTube upload interrupted; it will resume from its saved session.",
          true,
        );
      }
      if (r.status === 308) {
        save({ offset: end });
        return { pending: true };
      }
      if (!r.ok)
        throw new ProviderError(
          `YouTube upload failed (HTTP ${r.status}).`,
          r.status === 429 || r.status >= 500,
        );
      const result = remoteIdSchema.parse(await r.json());
      save({ remoteId: result.id, stage: "processing" });
    } else
      throw new ProviderError(
        `YouTube upload session is unavailable (HTTP ${probe.status}). Check the channel before creating another upload.`,
        probe.status >= 500,
        probe.status === 404,
      );
  }
  const result = z
    .object({
      items: z.array(
        z.object({
          status: z.object({
            uploadStatus: z.string(),
            privacyStatus: z.string(),
          }),
          processingDetails: z
            .object({ processingStatus: z.string() })
            .optional(),
        }),
      ),
    })
    .parse(
      await request(
        `https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${cp.remoteId}`,
        { headers },
      ),
    );
  const video = result.items[0];
  if (!video) return { pending: true };
  if (["failed", "rejected", "deleted"].includes(video.status.uploadStatus))
    throw new ProviderError(
      "YouTube rejected this upload. Check YouTube Studio.",
    );
  if (
    video.status.uploadStatus !== "processed" &&
    video.processingDetails?.processingStatus !== "succeeded"
  )
    return { pending: true };
  if (video.status.privacyStatus !== target.privacy)
    throw new ProviderError(
      "YouTube retained a different visibility than requested. Check channel or API project restrictions in YouTube Studio.",
    );
  const url = `https://www.youtube.com/watch?v=${cp.remoteId}`;
  save({ stage: "done", url });
  return { pending: false, remoteId: cp.remoteId, url };
}
