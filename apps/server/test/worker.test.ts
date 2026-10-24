import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import {
  savePost,
  schedulePost,
  getPost,
  cancelPost,
} from "../src/services/workspaceService.js";
import {
  processNext,
  recoverJobs,
  acquireLock,
  releaseLock,
  startWorker,
} from "../src/services/schedulingWorker.js";
import { ProviderError } from "../src/services/providerHttp.js";
test("cancellation preserves destinations already awaiting platform processing", async () => {
  const f = fixture();
  try {
    const a = f.account();
    const post = savePost(f.db, f.a.id, {
      caption: "In progress",
      targets: [{ accountId: a.id, format: "text" }],
    });
    schedulePost(f.db, f.a.id, post.id, { immediate: true });
    await processNext(f.db, f.config, "worker", async (context) => {
      context.save({ stage: "processing", remoteId: "already-uploaded" });
      return { pending: true, remoteId: "already-uploaded" };
    });
    assert.equal(cancelPost(f.db, f.a.id, post.id).state, "processing");
    assert.equal(
      getPost(f.db, f.a.id, post.id).targets[0]?.remoteId,
      "already-uploaded",
    );
  } finally {
    f.close();
  }
});
test("publishes once, preserves destination results, and never picks drafts", async () => {
  const f = fixture();
  try {
    const account = f.account();
    const draft = savePost(f.db, f.a.id, {
      caption: "Draft",
      targets: [{ accountId: account.id, format: "text" }],
    });
    let calls = 0;
    assert.equal(
      await processNext(f.db, f.config, "test", async () => {
        calls++;
        return { pending: false };
      }),
      false,
    );
    assert.equal(calls, 0);
    schedulePost(f.db, f.a.id, draft.id, { immediate: true });
    await processNext(f.db, f.config, "test", async (ctx) => {
      calls++;
      assert.equal(ctx.caption, "Draft");
      ctx.save({ stage: "done", remoteId: "remote-1" });
      return {
        pending: false,
        remoteId: "remote-1",
        url: "https://facebook.com/remote-1",
      };
    });
    assert.equal(getPost(f.db, f.a.id, draft.id).state, "published");
    assert.equal(
      await processNext(f.db, f.config, "test", async () => {
        calls++;
        return { pending: false };
      }),
      false,
    );
    assert.equal(calls, 1);
  } finally {
    f.close();
  }
});
test("one connection lock coordinates publishing across projects", async () => {
  const f = fixture();
  try {
    const account = f.account();
    for (const p of [f.a, f.b]) {
      const post = savePost(f.db, p.id, {
        caption: p.name,
        targets: [{ accountId: account.id, format: "text" }],
      });
      schedulePost(f.db, p.id, post.id, { immediate: true });
    }
    assert(acquireLock(f.db, `connection:${account.connectionId}`, "other"));
    let calls = 0;
    assert.equal(
      await processNext(f.db, f.config, "worker", async () => {
        calls++;
        return { pending: false };
      }),
      false,
    );
    releaseLock(f.db, `connection:${account.connectionId}`, "other");
    assert.equal(
      await processNext(f.db, f.config, "worker", async () => {
        calls++;
        return { pending: false, remoteId: "one" };
      }),
      true,
    );
    assert.equal(calls, 1);
  } finally {
    f.close();
  }
});
test("network ambiguity is held for attention rather than resent", async () => {
  const f = fixture();
  try {
    const a = f.account();
    const p = savePost(f.db, f.a.id, {
      caption: "Hello",
      targets: [{ accountId: a.id, format: "text" }],
    });
    schedulePost(f.db, f.a.id, p.id, { immediate: true });
    await processNext(f.db, f.config, "worker", async (ctx) => {
      ctx.save({ stage: "publishing" });
      throw new ProviderError("Response lost", false, true);
    });
    assert.equal(getPost(f.db, f.a.id, p.id).state, "needs_attention");
    assert.equal(await processNext(f.db, f.config, "worker"), false);
  } finally {
    f.close();
  }
});
test("safe processing resumes after a stale lease; unknown writes do not", () => {
  const f = fixture();
  try {
    const a = f.account();
    for (const stage of ["processing", "publishing"]) {
      const p = savePost(f.db, f.a.id, {
        caption: stage,
        targets: [{ accountId: a.id, format: "text" }],
      });
      schedulePost(f.db, f.a.id, p.id, { immediate: true });
      f.db
        .prepare(
          "UPDATE jobs SET status='processing',leaseUntil=?,checkpoint=? WHERE postId=?",
        )
        .run(
          new Date(0).toISOString(),
          JSON.stringify({
            stage,
            remoteId: stage === "processing" ? "remote" : undefined,
          }),
          p.id,
        );
      recoverJobs(f.db);
      assert.equal(
        getPost(f.db, f.a.id, p.id).state,
        stage === "processing" ? "processing" : "needs_attention",
      );
    }
  } finally {
    f.close();
  }
});
test("restarts mark missed posts and prevent two workers", async () => {
  const f = fixture();
  let stop: (() => Promise<void>) | undefined;
  try {
    const a = f.account();
    const p = savePost(f.db, f.a.id, {
      caption: "Missed",
      targets: [{ accountId: a.id, format: "text" }],
    });
    schedulePost(f.db, f.a.id, p.id, { immediate: true });
    f.db
      .prepare("UPDATE jobs SET availableAt=? WHERE postId=?")
      .run(new Date(Date.now() - 60000).toISOString(), p.id);
    stop = startWorker(f.db, f.config);
    assert.equal(getPost(f.db, f.a.id, p.id).state, "needs_attention");
    assert.throws(() => startWorker(f.db, f.config), /already running/);
  } finally {
    await stop?.();
    f.close();
  }
});

test("R2 preparation retries through the durable worker without duplicating publication", async (t) => {
  const { S3Client, HeadObjectCommand, PutObjectCommand } =
    await import("@aws-sdk/client-s3");
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const f = fixture();
  const mediaId = randomUUID();
  const bytes = Buffer.from([255, 216, 255, 219]);
  writeFileSync(join(f.config.mediaDir, mediaId), bytes);
  f.config.mediaDelivery = "r2";
  f.config.r2 = {
    endpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "private",
    accessKeyId: "test",
    secretAccessKey: "test",
    keyPrefix: "socialsync",
  };
  let unavailable = true;
  t.mock.method(S3Client.prototype, "send", async (command: unknown) => {
    if (unavailable) throw new Error("private-signature-and-secret");
    if (command instanceof HeadObjectCommand)
      throw Object.assign(new Error(), { name: "NotFound" });
    assert(command instanceof PutObjectCommand);
    assert.equal(command.input.Key, `socialsync/${f.a.id}/${mediaId}`);
    // Consume the stream just as the SDK transport does.
    const { Readable } = await import("node:stream");
    assert(command.input.Body instanceof Readable);
    for await (const chunk of command.input.Body)
      assert.deepEqual(Buffer.from(chunk), bytes);
    return {};
  });
  let publications = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      publications++;
      assert(init.body instanceof URLSearchParams);
      assert(init.body.get("url")?.includes("X-Amz-Signature"));
      return new Response(JSON.stringify({ id: "published-once" }), {
        headers: { "content-type": "application/json" },
      });
    },
  );
  try {
    f.db
      .prepare("INSERT INTO media VALUES (?,?,?,?,?,?)")
      .run(
        mediaId,
        f.a.id,
        "photo.jpg",
        "image/jpeg",
        bytes.length,
        new Date().toISOString(),
      );
    const a = f.account();
    assert.throws(
      () => savePost(f.db, f.b.id, { mediaIds: [mediaId] }),
      /Media|media/,
    );
    const post = savePost(f.db, f.a.id, {
      caption: "R2 retry",
      mediaIds: [mediaId],
      targets: [{ accountId: a.id, format: "image" }],
    });
    schedulePost(f.db, f.a.id, post.id, { immediate: true });
    await processNext(f.db, f.config, "worker");
    const job = f.db
      .prepare("SELECT status,checkpoint,error FROM jobs WHERE postId=?")
      .get(post.id);
    assert.deepEqual(job, {
      status: "scheduled",
      checkpoint: '{"retryCount":1}',
      error:
        "R2 media preparation failed. Check server configuration, bucket access, and the local media file, then retry.",
    });
    assert.equal(publications, 0);
    unavailable = false;
    f.db
      .prepare("UPDATE jobs SET availableAt=? WHERE postId=?")
      .run(new Date().toISOString(), post.id);
    await processNext(f.db, f.config, "worker");
    assert.equal(getPost(f.db, f.a.id, post.id).state, "published");
    assert.equal(publications, 1);
    assert.equal(await processNext(f.db, f.config, "worker"), false);
    assert.equal(publications, 1);
    const saved = JSON.stringify(
      f.db
        .prepare("SELECT checkpoint,error,url FROM jobs WHERE postId=?")
        .get(post.id),
    );
    assert(!/X-Amz|private-signature|test-secret/.test(saved));
  } finally {
    f.close();
  }
});
