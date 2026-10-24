import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import supertest from "supertest";
import sharp from "sharp";
import { prepareInstagramMedia } from "../src/services/instagramMediaService.js";
import { fixture } from "./helpers.js";
import { createApp } from "../src/app.js";
import { mediaSchema } from "@socialsync/shared";
import { mediaUrl } from "../src/services/publishingService.js";
import { savePost } from "../src/services/workspaceService.js";

test("uploads validate file content and signed links only deliver the correct project media", async () => {
  const f = fixture();
  f.config.mediaDir = join(f.config.dataDir, ".local/share/socialsync/media");
  mkdirSync(f.config.mediaDir, { recursive: true });
  try {
    const app = createApp(f.db, f.config),
      agent = supertest(app),
      image = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4]);
    const response = await agent
      .post(`/api/projects/${f.a.id}/media`)
      .set("Host", "127.0.0.1:3002")
      .set("X-SocialSync-Client", "1")
      .attach("file", image, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      })
      .expect(201);
    const media = mediaSchema.parse(response.body);
    await agent
      .get(`/api/projects/${f.b.id}/media/${media.id}/file`)
      .set("Host", "127.0.0.1:3002")
      .expect(404);
    const signed = new URL(await mediaUrl(f.config, media));
    const downloaded = await agent
      .get(signed.pathname + signed.search)
      .set("Host", "public.example.com")
      .expect(200);
    assert.deepEqual(downloaded.body, image);
    const png = await sharp({
      create: { width: 10, height: 10, channels: 4, background: "transparent" },
    })
      .png()
      .toBuffer();
    const pngUpload = await agent
      .post(`/api/projects/${f.a.id}/media`)
      .set("Host", "127.0.0.1:3002")
      .set("X-SocialSync-Client", "1")
      .attach("file", png, { filename: "photo.png", contentType: "image/png" })
      .expect(201);
    const pngMedia = mediaSchema.parse(pngUpload.body);
    const variant = await prepareInstagramMedia(f.config, pngMedia);
    const jpegUrl = new URL(await mediaUrl(f.config, pngMedia, variant));
    const jpeg = await agent
      .get(jpegUrl.pathname + jpegUrl.search)
      .set("Host", "public.example.com")
      .expect("Content-Type", /image\/jpeg/)
      .expect(200);
    assert.equal((await sharp(jpeg.body as Buffer).metadata()).format, "jpeg");
    jpegUrl.searchParams.delete("variant");
    await agent
      .get(jpegUrl.pathname + jpegUrl.search)
      .set("Host", "public.example.com")
      .expect(403);
    const pngPreview = await agent
      .get(`/api/projects/${f.a.id}/media/${pngMedia.id}/file`)
      .set("Host", "127.0.0.1:3002")
      .expect(200);
    assert.deepEqual(pngPreview.body, png);
    savePost(f.db, f.a.id, { mediaIds: [media.id] });
    await agent
      .delete(`/api/projects/${f.a.id}/media/${media.id}`)
      .set("Host", "127.0.0.1:3002")
      .set("X-SocialSync-Client", "1")
      .expect(409);
    const before = readdirSync(f.config.mediaDir).length;
    await agent
      .post(`/api/projects/${f.a.id}/media`)
      .set("Host", "127.0.0.1:3002")
      .set("X-SocialSync-Client", "1")
      .attach("file", Buffer.from("not an image"), {
        filename: "fake.jpg",
        contentType: "image/jpeg",
      })
      .expect(400);
    assert.equal(readdirSync(f.config.mediaDir).length, before);
  } finally {
    f.close();
  }
});

test("R2 readiness keeps health shape, local previews, and local deletion without storage calls", async () => {
  const f = fixture();
  f.config.mediaDelivery = "r2";
  f.config.publicMediaOrigin = "";
  f.config.r2 = {
    endpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "private",
    accessKeyId: "test-secret-id",
    secretAccessKey: "test-secret",
    keyPrefix: "socialsync",
  };
  try {
    const agent = supertest(createApp(f.db, f.config));
    const health = await agent
      .get("/api/health")
      .set("Host", "127.0.0.1:3002")
      .expect(200);
    assert.deepEqual(health.body, {
      ok: true,
      workerOnline: false,
      publicMediaReady: true,
    });
    const image = Buffer.from([255, 216, 255, 219]);
    const upload = await agent
      .post(`/api/projects/${f.a.id}/media`)
      .set("Host", "127.0.0.1:3002")
      .set("X-SocialSync-Client", "1")
      .attach("file", image, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      })
      .expect(201);
    assert(!JSON.stringify(upload.body).includes("test-secret"));
    const media = mediaSchema.parse(upload.body);
    const preview = await agent
      .get(`/api/projects/${f.a.id}/media/${media.id}/file`)
      .set("Host", "127.0.0.1:3002")
      .expect(200);
    assert.deepEqual(preview.body, image);
    await agent
      .delete(`/api/projects/${f.a.id}/media/${media.id}`)
      .set("Host", "127.0.0.1:3002")
      .set("X-SocialSync-Client", "1")
      .expect(200);
    assert(!readdirSync(f.config.mediaDir).includes(media.id));
  } finally {
    f.close();
  }
});
