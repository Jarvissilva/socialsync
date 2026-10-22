import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import supertest from "supertest";
import { fixture } from "./helpers.js";
import { createApp } from "../src/app.js";
import { mediaSchema } from "@social/shared";
import { mediaUrl } from "../src/services/publishingService.js";
import { savePost } from "../src/services/workspaceService.js";

test("uploads validate file content and signed links only deliver the correct project media", async () => {
  const f = fixture();
  try {
    const app = createApp(f.db, f.config),
      agent = supertest(app),
      image = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4]);
    const response = await agent
      .post(`/api/projects/${f.a.id}/media`)
      .set("Host", "127.0.0.1:3002")
      .set("X-SocialDesk-Client", "1")
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
    const signed = new URL(mediaUrl(f.config, media));
    const downloaded = await agent
      .get(signed.pathname + signed.search)
      .set("Host", "public.example.com")
      .expect(200);
    assert.deepEqual(downloaded.body, image);
    savePost(f.db, f.a.id, { mediaIds: [media.id] });
    await agent
      .delete(`/api/projects/${f.a.id}/media/${media.id}`)
      .set("Host", "127.0.0.1:3002")
      .set("X-SocialDesk-Client", "1")
      .expect(409);
    const before = readdirSync(f.config.mediaDir).length;
    await agent
      .post(`/api/projects/${f.a.id}/media`)
      .set("Host", "127.0.0.1:3002")
      .set("X-SocialDesk-Client", "1")
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
