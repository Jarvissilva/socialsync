import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import sharp from "sharp";
import type { Request, Response } from "express";
import { targetInputSchema, validateContent, type Media } from "@socialsync/shared";
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  type HeadObjectOutput,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { fixture } from "./helpers.js";
import {
  instagramVariant,
  mediaPath,
  prepareInstagramMedia,
  variantDirectory,
} from "../src/services/instagramMediaService.js";
import { mediaUrl } from "../src/services/mediaDeliveryService.js";
import {
  deleteMedia,
  savePost,
  schedulePost,
} from "../src/services/workspaceService.js";
import { processNext } from "../src/services/schedulingWorker.js";
import { publicController } from "../src/controllers/publicController.js";
import { ProviderError } from "../src/services/providerHttp.js";
import { accountRowSchema, one } from "../src/database.js";
import {
  publish,
  type PublishContext,
} from "../src/services/publishingService.js";
import { signature } from "../src/lib/security.js";

type Fixture = ReturnType<typeof fixture>;
function store(f: Fixture, bytes: Buffer, mime: string): Media {
  const media = {
    id: randomUUID(),
    projectId: f.a.id,
    name: "image",
    mime,
    size: bytes.length,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(mediaPath(f.config.mediaDir, media), bytes);
  f.db
    .prepare("INSERT INTO media VALUES (?,?,?,?,?,?)")
    .run(
      media.id,
      media.projectId,
      media.name,
      mime,
      media.size,
      media.createdAt,
    );
  return media;
}
function image() {
  return sharp({
    create: {
      width: 20,
      height: 10,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
}
async function animated(format: "gif" | "webp") {
  const bytes = Buffer.concat([Buffer.alloc(12, 0), Buffer.alloc(12, 255)]);
  return sharp(bytes, {
    raw: { width: 2, height: 4, channels: 3, pageHeight: 2 },
  })
    .toFormat(format, { delay: [100, 100], loop: 0 })
    .toBuffer();
}
function safePreparationError(error: unknown) {
  assert(error instanceof ProviderError);
  assert.equal(error.retryable, false);
  assert.equal(error.uncertain, false);
  assert(!/\/tmp|secret|vips/i.test(error.message));
  return true;
}

test("PNG, WebP and still GIF convert to white sRGB JPEGs, preserve originals, and reuse atomic derivatives", async () => {
  const f = fixture();
  try {
    for (const format of ["png", "webp", "gif"] as const) {
      const bytes = await image().toFormat(format).toBuffer();
      const media = store(f, bytes, `image/${format}`);
      assert.equal(
        await prepareInstagramMedia(f.config, media),
        instagramVariant,
      );
      const path = mediaPath(f.config.mediaDir, media, instagramVariant);
      const metadata = await sharp(path).metadata();
      assert.equal(metadata.format, "jpeg");
      assert.equal(metadata.space, "srgb");
      assert.equal(metadata.width, 20);
      assert.equal(metadata.height, 10);
      assert.equal(metadata.hasAlpha, false);
      const pixels = await sharp(path).raw().toBuffer();
      assert(pixels.every((value) => value >= 253));
      const before = statSync(path);
      const derivative = readFileSync(path);
      await prepareInstagramMedia(f.config, media);
      assert.equal(statSync(path).mtimeMs, before.mtimeMs);
      assert.deepEqual(readFileSync(path), derivative);
      assert.deepEqual(
        readFileSync(mediaPath(f.config.mediaDir, media)),
        bytes,
      );
      assert.deepEqual(
        readdirSync(variantDirectory(f.config.mediaDir, media)),
        [instagramVariant],
      );
      assert.notEqual(
        path,
        mediaPath(
          f.config.mediaDir,
          { ...media, projectId: f.b.id },
          instagramVariant,
        ),
      );
      assert.throws(() =>
        deleteMedia(f.db, f.b.id, media.id, f.config.mediaDir),
      );
      assert(existsSync(path));
      deleteMedia(f.db, f.a.id, media.id, f.config.mediaDir);
      assert(!existsSync(path));
      assert(!existsSync(mediaPath(f.config.mediaDir, media)));
    }
  } finally {
    f.close();
  }
});

test("conversion applies EXIF orientation without resizing and passes JPEG/video through", async () => {
  const f = fixture();
  try {
    const media = store(
      f,
      await image().withMetadata({ orientation: 6 }).png().toBuffer(),
      "image/png",
    );
    await prepareInstagramMedia(f.config, media);
    const metadata = await sharp(
      mediaPath(f.config.mediaDir, media, instagramVariant),
    ).metadata();
    assert.equal(metadata.width, 10);
    assert.equal(metadata.height, 20);
    assert.equal(metadata.orientation, undefined);
    for (const mime of ["image/jpeg", "video/mp4", "video/quicktime"]) {
      const original = store(f, Buffer.from("unchanged"), mime);
      assert.equal(await prepareInstagramMedia(f.config, original), undefined);
      assert(!existsSync(variantDirectory(f.config.mediaDir, original)));
    }
  } finally {
    f.close();
  }
});

test("animated GIF/WebP/APNG, corrupt and unsupported contents fail safely", async () => {
  const f = fixture();
  try {
    for (const format of ["gif", "webp"] as const) {
      const bytes = await animated(format);
      assert.equal((await sharp(bytes).metadata()).pages, 2);
      await assert.rejects(
        () =>
          prepareInstagramMedia(f.config, store(f, bytes, `image/${format}`)),
        /Animated images/,
      );
    }
    const png = await image().png().toBuffer();
    // A PNG animation-control chunk, with a correct CRC, before IDAT.
    const acTL = Buffer.from("000000086163544c0000000200000000f38d9370", "hex");
    const apng = Buffer.concat([png.subarray(0, 33), acTL, png.subarray(33)]);
    await assert.rejects(
      () => prepareInstagramMedia(f.config, store(f, apng, "image/png")),
      /Animated images/,
    );
    for (const bytes of [
      Buffer.from("corrupt"),
      png.subarray(0, 45),
      await image().tiff().toBuffer(),
    ]) {
      await assert.rejects(
        () => prepareInstagramMedia(f.config, store(f, bytes, "image/png")),
        safePreparationError,
      );
    }
    assert.throws(() =>
      mediaPath(
        f.config.mediaDir,
        { ...store(f, png, "image/png"), projectId: "../escape" },
        instagramVariant,
      ),
    );
  } finally {
    f.close();
  }
});

function context(
  f: Fixture,
  media: Media[],
  format: "image" | "carousel" | "story" = "image",
  platform: "instagram" | "facebook" | "pinterest" = "instagram",
): PublishContext {
  const account = f.account(platform);
  const row = one(
    f.db,
    accountRowSchema,
    "SELECT * FROM accounts WHERE id=?",
    account.id,
  );
  assert(row);
  return {
    config: f.config,
    account: row,
    tokens: {
      accessToken: "test",
      accountTokens: { [account.externalId]: "test" },
    },
    target: targetInputSchema.parse({
      accountId: row.id,
      format,
      boardId: "board",
    }),
    caption: "caption",
    media,
    checkpoint: {},
    save: () => {},
  };
}

test("Instagram single images, carousels, and Stories use JPEG variants in order", async (t) => {
  const f = fixture();
  try {
    for (const format of ["image", "carousel", "story"] as const) {
      const media = [store(f, await image().png().toBuffer(), "image/png")];
      if (format === "carousel")
        media.push(store(f, await image().webp().toBuffer(), "image/webp"));
      const ctx = context(f, media, format);
      const sent: string[] = [];
      const fetchMock = t.mock.method(
        globalThis,
        "fetch",
        async (input: string, init: RequestInit = {}) => {
          let body: unknown = {};
          if (input.endsWith("/media")) {
            assert(init.body instanceof URLSearchParams);
            const url = init.body.get("image_url");
            if (url) {
              sent.push(url);
              assert.equal(
                new URL(url).searchParams.get("variant"),
                instagramVariant,
              );
            }
            if (format === "story") {
              assert.equal(init.body.get("media_type"), "STORIES");
              assert(!init.body.has("caption"));
            }
            body = { id: `container-${sent.length}` };
          } else if (input.includes("status_code"))
            body = { status_code: "FINISHED" };
          else if (input.endsWith("/media_publish")) body = { id: "published" };
          return new Response(JSON.stringify(body));
        },
      );
      assert.equal((await publish(ctx)).remoteId, "published");
      assert.deepEqual(
        sent.map((url) => new URL(url).pathname.split("/").at(-1)),
        media.map((m) => m.id),
      );
      fetchMock.mock.restore();
    }
  } finally {
    f.close();
  }
});

test("carousel preflight rejects bad later images before new containers and preserves checkpoints", async (t) => {
  const f = fixture();
  let calls = 0;
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async (): Promise<Response> => {
      calls++;
      throw new Error("Unexpected provider call");
    },
  );
  try {
    for (const bad of [Buffer.from("corrupt"), await animated("gif")]) {
      const media = [
        store(f, await image().png().toBuffer(), "image/png"),
        store(f, bad, "image/gif"),
      ];
      const ctx = context(f, media, "carousel");
      await assert.rejects(() => publish(ctx), safePreparationError);
      assert.deepEqual(ctx.checkpoint, {});
      ctx.checkpoint.children = ["existing-child"];
      await assert.rejects(() => publish(ctx), safePreparationError);
      assert.deepEqual(ctx.checkpoint.children, ["existing-child"]);
      assert.equal(calls, 0);
    }
    const ctx = context(f, [store(f, Buffer.from("corrupt"), "image/png")]);
    ctx.checkpoint = { containerId: "existing", stage: "publishing" };
    fetchMock.mock.mockImplementation(
      async () => new Response(JSON.stringify({ status_code: "FINISHED" })),
    );
    await assert.rejects(
      () => publish(ctx),
      (error: unknown) => error instanceof ProviderError && error.uncertain,
    );
    assert.equal(ctx.checkpoint.containerId, "existing");
  } finally {
    f.close();
  }
});

test("Facebook and Pinterest receive originals even when Instagram has a derivative", async (t) => {
  const f = fixture();
  try {
    const media = store(f, await image().png().toBuffer(), "image/png");
    await prepareInstagramMedia(f.config, media);
    const sent: string[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string, init: RequestInit = {}) => {
        if (input.endsWith("/photos")) {
          assert(init.body instanceof URLSearchParams);
          sent.push(init.body.get("url")!);
        } else if (input.endsWith("/pins")) {
          const body = JSON.parse(String(init.body)) as {
            media_source: { url: string };
          };
          sent.push(body.media_source.url);
        }
        return new Response(JSON.stringify({ id: "published" }));
      },
    );
    for (const platform of ["facebook", "pinterest"] as const)
      await publish(context(f, [media], "image", platform));
    assert.equal(sent.length, 2);
    for (const url of sent) assert(!new URL(url).searchParams.has("variant"));
  } finally {
    f.close();
  }
});

test("signed variant delivery binds variant, project, expiry and database ownership; original URLs remain valid", async () => {
  const f = fixture();
  try {
    const media = store(f, await image().png().toBuffer(), "image/png");
    await prepareInstagramMedia(f.config, media);
    const deliver = publicController(f.db, f.config).deliverMedia;
    function call(url: URL, projectId = media.projectId) {
      let path = "",
        mime = "";
      deliver(
        {
          params: { projectId, mediaId: media.id },
          query: Object.fromEntries(url.searchParams),
        } as unknown as Request,
        {
          setHeader: () => {},
          type: (value: string) => {
            mime = value;
          },
          sendFile: (value: string, options: { root: string }) => {
            path = join(options.root, value);
          },
        } as unknown as Response,
        () => {},
      );
      return { path, mime };
    }
    const original = new URL(await mediaUrl(f.config, media));
    const variant = new URL(await mediaUrl(f.config, media, instagramVariant));
    assert.deepEqual(call(original), {
      path: mediaPath(f.config.mediaDir, media),
      mime: "image/png",
    });
    const delivered = call(variant);
    assert.equal(delivered.mime, "image/jpeg");
    assert.equal(
      (await sharp(readFileSync(delivered.path)).metadata()).format,
      "jpeg",
    );
    const stripped = new URL(variant);
    stripped.searchParams.delete("variant");
    assert.throws(() => call(stripped), /expired or is invalid/);
    const added = new URL(original);
    added.searchParams.set("variant", instagramVariant);
    assert.throws(() => call(added), /expired or is invalid/);
    assert.throws(() => call(variant, f.b.id), /expired or is invalid/);
    const foreign = new URL(
      await mediaUrl(
        f.config,
        { ...media, projectId: f.b.id },
        instagramVariant,
      ),
    );
    assert.throws(() => call(foreign, f.b.id), /not found in this project/);
    const expired = new URL(variant);
    const expires = String(Date.now() - 1000);
    expired.searchParams.set("expires", expires);
    expired.searchParams.set(
      "signature",
      signature(
        `${media.projectId}:${media.id}:${expires}:${instagramVariant}`,
        f.config.encryptionKey,
      ),
    );
    assert.throws(() => call(expired), /expired or is invalid/);
    deleteMedia(f.db, f.a.id, media.id, f.config.mediaDir);
    assert.throws(() => call(variant), /not found in this project/);
  } finally {
    f.close();
  }
});

test("R2 variants have deterministic separate keys and JPEG metadata and reuse uploads", async (t) => {
  const f = fixture();
  f.config.mediaDelivery = "r2";
  f.config.r2 = {
    endpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "private",
    accessKeyId: "test",
    secretAccessKey: "test",
    keyPrefix: "socialsync",
  };
  try {
    const bytes = await image().png().toBuffer();
    const media = store(f, bytes, "image/png");
    await prepareInstagramMedia(f.config, media);
    const objects = new Map<string, HeadObjectOutput>();
    let uploads = 0;
    t.mock.method(S3Client.prototype, "send", async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        const head = objects.get(command.input.Key!);
        if (!head) throw Object.assign(new Error(), { name: "NotFound" });
        return head;
      }
      assert(command instanceof PutObjectCommand);
      assert(command.input.Body instanceof Readable);
      const chunks: Buffer[] = [];
      for await (const chunk of command.input.Body)
        chunks.push(Buffer.from(chunk));
      const output = Buffer.concat(chunks);
      assert.equal(output.length, command.input.ContentLength);
      if (command.input.Key!.endsWith(".jpg")) {
        assert.equal(command.input.ContentType, "image/jpeg");
        assert.equal((await sharp(output).metadata()).format, "jpeg");
      } else {
        assert.deepEqual(output, bytes);
        assert.equal(command.input.ContentType, "image/png");
      }
      objects.set(command.input.Key!, {
        ContentLength: output.length,
        ContentType: command.input.ContentType,
        Metadata: command.input.Metadata,
        LastModified: new Date(),
      });
      uploads++;
      return {};
    });
    const variant = new URL(await mediaUrl(f.config, media, instagramVariant));
    assert.equal(
      variant.pathname,
      `/socialsync/${media.projectId}/${media.id}/${instagramVariant}.jpg`,
    );
    await mediaUrl(f.config, media, instagramVariant);
    const original = new URL(await mediaUrl(f.config, media));
    assert.equal(
      original.pathname,
      `/socialsync/${media.projectId}/${media.id}`,
    );
    assert.equal(uploads, 2);
  } finally {
    f.close();
  }
});

test("shared validation accepts convertible Instagram formats and rejects unsupported images", () => {
  const target = targetInputSchema.parse({
    accountId: randomUUID(),
    format: "image",
  });
  for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif"])
    assert.deepEqual(
      validateContent("instagram", target, [{ mime, size: 100 }], ""),
      [],
    );
  assert(
    validateContent(
      "instagram",
      target,
      [{ mime: "image/tiff", size: 100 }],
      "",
    ).some((error) => error.includes("still GIF")),
  );
});

test("worker fails invalid Instagram media without retrying or creating containers", async (t) => {
  const f = fixture();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("Unexpected provider call");
  });
  try {
    const media = store(f, Buffer.from("corrupt PNG"), "image/png");
    const account = f.account("instagram");
    const post = savePost(f.db, f.a.id, {
      mediaIds: [media.id],
      targets: [{ accountId: account.id, format: "image" }],
    });
    schedulePost(f.db, f.a.id, post.id, { immediate: true });
    assert(await processNext(f.db, f.config, "worker"));
    const job = f.db
      .prepare("SELECT status, error, availableAt FROM jobs WHERE postId=?")
      .get(post.id);
    assert.deepEqual(job, {
      status: "failed",
      error:
        "Instagram image preparation failed. Choose a valid PNG, WebP, or still GIF image and try again.",
      availableAt: null,
    });
    assert.equal(await processNext(f.db, f.config, "worker"), false);
    assert.equal(calls, 0);
  } finally {
    f.close();
  }
});

test("resuming a mixed carousel preserves prior children and passes JPEG/video URLs through", async (t) => {
  const f = fixture();
  try {
    const media = [
      store(f, Buffer.from("already sent"), "image/png"),
      store(f, await image().png().toBuffer(), "image/png"),
      store(f, await image().jpeg().toBuffer(), "image/jpeg"),
      store(f, Buffer.from("video bytes"), "video/mp4"),
    ];
    const ctx = context(f, media, "carousel");
    ctx.checkpoint.children = ["existing-child"];
    let childIndex = 1;
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string, init: RequestInit = {}) => {
        if (input.endsWith("/media")) {
          assert(init.body instanceof URLSearchParams);
          if (init.body.get("is_carousel_item")) {
            const url = new URL(
              init.body.get("image_url") || init.body.get("video_url") || "",
            );
            assert(url.pathname.endsWith(media[childIndex]!.id));
            assert.equal(
              url.searchParams.get("variant"),
              childIndex === 1 ? instagramVariant : null,
            );
            if (childIndex === 3)
              assert.equal(init.body.get("media_type"), "VIDEO");
            return new Response(
              JSON.stringify({ id: `child-${childIndex++}` }),
            );
          }
          assert.equal(
            init.body.get("children"),
            "existing-child,child-1,child-2,child-3",
          );
          return new Response(JSON.stringify({ id: "parent" }));
        }
        if (input.includes("status_code"))
          return new Response(JSON.stringify({ status_code: "FINISHED" }));
        return new Response(JSON.stringify({ id: "published" }));
      },
    );
    assert.equal((await publish(ctx)).remoteId, "published");
    assert.equal(childIndex, 4);
    assert.deepEqual(ctx.checkpoint.children, [
      "existing-child",
      "child-1",
      "child-2",
      "child-3",
    ]);
  } finally {
    f.close();
  }
});
