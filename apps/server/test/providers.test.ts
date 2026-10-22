import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { targetInputSchema, type Platform, type Format } from "@social/shared";
import { one, accountRowSchema } from "../src/database.js";
import {
  publish,
  type PublishContext,
} from "../src/services/publishingService.js";
import { fixture } from "./helpers.js";

function context(platform: Platform, format: Format, mimes: string[]) {
  const f = fixture();
  const a = f.account(platform);
  const account = one(
    f.db,
    accountRowSchema,
    "SELECT * FROM accounts WHERE id=?",
    a.id,
  );
  if (!account) throw new Error("Account missing.");
  const ctx: PublishContext = {
    config: f.config,
    account,
    tokens: { accessToken: "test", accountTokens: { [a.externalId]: "page" } },
    target: targetInputSchema.parse({
      accountId: a.id,
      format,
      title: "A video",
      boardId: "board-1",
    }),
    caption: "Hello world",
    media: mimes.map((mime) => {
      const id = randomUUID();
      writeFileSync(
        join(f.config.mediaDir, id),
        Buffer.from("test video bytes"),
      );
      return {
        id,
        projectId: f.a.id,
        name: "upload",
        mime,
        size: 16,
        createdAt: new Date().toISOString(),
      };
    }),
    checkpoint: {},
    save: (value) => {
      Object.assign(ctx.checkpoint, value);
    },
  };
  return { f, ctx };
}
function response(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
async function withFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  run: () => Promise<void>,
) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => handler(String(input), init);
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
}

test("Instagram persists a container then publishes and resolves its permalink", async () => {
  const { f, ctx } = context("instagram", "image", ["image/jpeg"]);
  const calls: string[] = [];
  try {
    await withFetch(
      (url, init) => {
        calls.push(url);
        if (url.endsWith("/media")) {
          assert(init.body instanceof URLSearchParams);
          assert(init.body.get("image_url")?.includes("/public/media/"));
          return response({ id: "container" });
        }
        if (url.includes("status_code"))
          return response({ status_code: "FINISHED" });
        if (url.endsWith("/media_publish")) return response({ id: "ig-post" });
        return response({ permalink: "https://www.instagram.com/p/test/" });
      },
      async () => {
        const result = await publish(ctx);
        assert.equal(result.remoteId, "ig-post");
        assert.equal(ctx.checkpoint.stage, "done");
        await publish(ctx);
        assert.equal(
          calls.filter((u) => u.endsWith("/media_publish")).length,
          1,
        );
      },
    );
  } finally {
    f.close();
  }
});
test("Instagram carousel and Story requests use distinct media parameters", async () => {
  for (const format of ["carousel", "story"] as const) {
    const { f, ctx } = context(
      "instagram",
      format,
      format === "carousel" ? ["image/jpeg", "image/jpeg"] : ["image/jpeg"],
    );
    let child = 0;
    try {
      await withFetch(
        (url, init) => {
          if (url.endsWith("/media")) {
            assert(init.body instanceof URLSearchParams);
            if (init.body.get("is_carousel_item"))
              return response({ id: `child-${++child}` });
            assert.equal(
              init.body.get("media_type"),
              format === "carousel" ? "CAROUSEL" : "STORIES",
            );
            if (format === "story")
              assert.equal(init.body.has("caption"), false);
            return response({ id: "container" });
          }
          if (url.includes("status_code"))
            return response({ status_code: "FINISHED" });
          if (url.endsWith("/media_publish"))
            return response({ id: "published" });
          return response({});
        },
        async () => {
          assert.equal((await publish(ctx)).remoteId, "published");
          assert.equal(child, format === "carousel" ? 2 : 0);
        },
      );
    } finally {
      f.close();
    }
  }
});
test("Facebook text/link posts and multi-photo posts create one feed publication", async () => {
  for (const format of ["text", "carousel"] as const) {
    const { f, ctx } = context(
      "facebook",
      format,
      format === "text" ? [] : ["image/png", "image/png"],
    );
    ctx.target.link = "https://example.com";
    let photos = 0,
      feeds = 0;
    try {
      await withFetch(
        (url, init) => {
          assert(init.body instanceof URLSearchParams);
          if (url.endsWith("/photos")) {
            assert.equal(init.body.get("published"), "false");
            return response({ id: `photo-${++photos}` });
          }
          assert(url.endsWith("/feed"));
          feeds++;
          if (format === "text")
            assert.equal(init.body.get("link"), "https://example.com");
          else assert(init.body.has("attached_media[1]"));
          return response({ id: "fb-post" });
        },
        async () => {
          const result = await publish(ctx);
          assert.equal(result.remoteId, "fb-post");
          assert.equal(feeds, 1);
          assert.equal(photos, format === "carousel" ? 2 : 0);
        },
      );
    } finally {
      f.close();
    }
  }
});
test("Facebook Reels and video Stories use start, transfer, finish, and processing checks", async () => {
  for (const format of ["reel", "story"] as const) {
    const { f, ctx } = context("facebook", format, ["video/mp4"]);
    let transferred = false,
      finished = false;
    try {
      await withFetch(
        (url, init) => {
          if (url.includes("rupload.facebook.com")) {
            assert(
              new Headers(init.headers).get("file_url")?.startsWith("https://"),
            );
            transferred = true;
            return response({ success: true });
          }
          if (url.includes("fields=status"))
            return response({
              status: {
                video_status: "ready",
                publishing_phase: { status: "complete" },
              },
            });
          assert(init.body instanceof URLSearchParams);
          if (init.body.get("upload_phase") === "start")
            return response({
              video_id: "fb-video",
              upload_url: "https://rupload.facebook.com/video-upload",
            });
          assert.equal(init.body.get("upload_phase"), "finish");
          assert(transferred);
          finished = true;
          return response({ success: true });
        },
        async () => {
          assert.equal((await publish(ctx)).remoteId, "fb-video");
          assert(finished);
        },
      );
    } finally {
      f.close();
    }
  }
});
test("Facebook image Stories publish the uploaded photo through photo_stories", async () => {
  const { f, ctx } = context("facebook", "story", ["image/jpeg"]);
  try {
    await withFetch(
      (url, init) => {
        assert(init.body instanceof URLSearchParams);
        if (url.endsWith("/photos")) return response({ id: "photo" });
        assert(url.endsWith("/photo_stories"));
        assert.equal(init.body.get("photo_id"), "photo");
        return response({ post_id: "story", success: true });
      },
      async () => {
        assert.equal((await publish(ctx)).remoteId, "story");
      },
    );
  } finally {
    f.close();
  }
});
test("Pinterest image and video Pins use the selected board and correct media source", async () => {
  for (const video of [false, true]) {
    const { f, ctx } = context("pinterest", video ? "video" : "pin", [
      video ? "video/mp4" : "image/jpeg",
    ]);
    let uploaded = false;
    try {
      await withFetch(
        (url, init) => {
          if (url === "https://api.pinterest.com/v5/media")
            return response({
              media_id: "123",
              upload_url: "https://bucket.s3.amazonaws.com/upload",
              upload_parameters: { key: "test" },
            });
          if (url.includes("amazonaws.com")) {
            assert(init.body instanceof FormData);
            uploaded = true;
            return response(null, 204);
          }
          if (url.includes("/media/123"))
            return response({ status: "succeeded" });
          assert(url.endsWith("/pins"));
          assert.equal(typeof init.body, "string");
          const payload = JSON.parse(String(init.body));
          assert.equal(payload.board_id, "board-1");
          assert.equal(
            payload.media_source.source_type,
            video ? "video_id" : "image_url",
          );
          if (video) assert(uploaded);
          return response({ id: "pin-1" });
        },
        async () => {
          assert.equal(
            (await publish(ctx)).url,
            "https://www.pinterest.com/pin/pin-1/",
          );
        },
      );
    } finally {
      f.close();
    }
  }
});
test("YouTube persists the session, uploads bytes, and confirms processing and visibility", async () => {
  const { f, ctx } = context("youtube", "short", ["video/mp4"]);
  let chunks = 0;
  try {
    await withFetch(
      (url, init) => {
        if (url.includes("uploadType=resumable")) {
          assert.equal(
            JSON.parse(String(init.body)).status.privacyStatus,
            "public",
          );
          return response({}, 200, {
            location:
              "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test",
          });
        }
        if (url.includes("upload_id=test")) {
          if (
            new Headers(init.headers)
              .get("Content-Range")
              ?.startsWith("bytes */")
          )
            return response({}, 308);
          assert(init.body instanceof Blob);
          chunks++;
          return response({ id: "yt-video" });
        }
        return response({
          items: [
            {
              status: { uploadStatus: "processed", privacyStatus: "public" },
              processingDetails: { processingStatus: "succeeded" },
            },
          ],
        });
      },
      async () => {
        assert.equal(
          (await publish(ctx)).url,
          "https://www.youtube.com/watch?v=yt-video",
        );
        assert.equal(chunks, 1);
        await publish(ctx);
        assert.equal(chunks, 1);
      },
    );
  } finally {
    f.close();
  }
});
test("YouTube reconciles a completed upload after losing the transfer response", async () => {
  const { f, ctx } = context("youtube", "video", ["video/mp4"]);
  ctx.checkpoint.uploadUrl =
    "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=saved";
  ctx.checkpoint.stage = "uploading";
  try {
    await withFetch(
      (url) =>
        url.includes("upload_id=saved")
          ? response({ id: "already-uploaded" })
          : response({
              items: [
                {
                  status: {
                    uploadStatus: "processed",
                    privacyStatus: "public",
                  },
                },
              ],
            }),
      async () => {
        assert.equal((await publish(ctx)).remoteId, "already-uploaded");
      },
    );
  } finally {
    f.close();
  }
});

test("Instagram chooses Facebook Graph and the linked Page token only for Meta authorizations", async () => {
  for (const facebookLogin of [true, false]) {
    const { f, ctx } = context("instagram", "image", ["image/jpeg"]);
    const previous = globalThis.fetch;
    let writes = 0;
    ctx.tokens = {
      accessToken: "direct-user",
      accountTokens: { [ctx.account.externalId]: "linked-page" },
      ...(facebookLogin ? { instagramLogin: "facebook" as const } : {}),
    };
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(
        url.hostname,
        facebookLogin ? "graph.facebook.com" : "graph.instagram.com",
      );
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `Bearer ${facebookLogin ? "linked-page" : "direct-user"}`,
      );
      if (init?.method === "POST") {
        writes++;
        return response({
          id: url.pathname.endsWith("media_publish")
            ? "published"
            : "container",
        });
      }
      return response(
        url.searchParams.get("fields") === "status_code"
          ? { status_code: "FINISHED" }
          : { permalink: "https://www.instagram.com/p/demo/" },
      );
    };
    try {
      let result = await publish(ctx);
      for (let i = 0; result.pending && i < 5; i++) result = await publish(ctx);
      assert.equal(result.remoteId, "published");
      assert.equal(writes, 2);
      await publish(ctx);
      assert.equal(writes, 2);
      if (facebookLogin) {
        ctx.checkpoint = {};
        ctx.tokens.accountTokens = {};
        await assert.rejects(() => publish(ctx), /Missing Page authorization/);
        assert.equal(writes, 2);
      }
    } finally {
      globalThis.fetch = previous;
      f.close();
    }
  }
});
