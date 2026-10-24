import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  type HeadObjectOutput,
} from "@aws-sdk/client-s3";
import type { Media } from "@socialsync/shared";
import { mediaUrl } from "../src/services/mediaDeliveryService.js";
import { ProviderError } from "../src/services/providerHttp.js";
import { fixture } from "./helpers.js";

function useR2(config: ReturnType<typeof fixture>["config"]) {
  config.mediaDelivery = "r2";
  config.publicMediaOrigin = "";
  config.r2 = {
    endpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "private",
    accessKeyId: "test-access",
    secretAccessKey: "test-secret",
    keyPrefix: "socialsync",
  };
}

test("R2 streams selected local bytes, isolates project keys, reuses copies, and renews signatures", async (t) => {
  const f = fixture();
  useR2(f.config);
  const bytes = Buffer.from([255, 216, 255, 219, 1, 2]);
  const media: Media = {
    id: randomUUID(),
    projectId: f.a.id,
    name: "photo.jpg",
    mime: "image/jpeg",
    size: bytes.length,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(f.config.mediaDir, media.id), bytes);
  writeFileSync(join(f.config.mediaDir, randomUUID()), "unselected");
  const objects = new Map<string, HeadObjectOutput>();
  let uploads = 0;
  t.mock.method(S3Client.prototype, "send", async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      const key = command.input.Key!;
      const head = objects.get(key);
      if (!head)
        throw Object.assign(new Error("missing"), { name: "NotFound" });
      return head;
    }
    assert(command instanceof PutObjectCommand);
    const { Body, Key, ContentLength, ContentType, Metadata } = command.input;
    assert(Body instanceof Readable);
    const chunks: Buffer[] = [];
    for await (const chunk of Body) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.equal(ContentLength, bytes.length);
    assert.equal(ContentType, media.mime);
    objects.set(Key!, {
      ContentLength,
      ContentType,
      Metadata,
      LastModified: new Date(),
    });
    uploads++;
    return {};
  });
  try {
    const first = new URL(await mediaUrl(f.config, media));
    assert.equal(first.hostname, "private.account.r2.cloudflarestorage.com");
    assert.equal(first.pathname, `/socialsync/${f.a.id}/${media.id}`);
    assert.equal(first.searchParams.get("X-Amz-Expires"), "86400");
    assert(first.searchParams.has("X-Amz-Signature"));
    assert.equal(uploads, 1);
    await mediaUrl(f.config, media);
    assert.equal(uploads, 1);
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 120_000 });
    assert.notEqual(await mediaUrl(f.config, media), first.toString());
    const other = new URL(
      await mediaUrl(f.config, { ...media, projectId: f.b.id }),
    );
    assert.equal(other.pathname, `/socialsync/${f.b.id}/${media.id}`);
    assert.equal(uploads, 2);
    assert.deepEqual(
      [...objects.keys()].sort(),
      [
        `socialsync/${f.a.id}/${media.id}`,
        `socialsync/${f.b.id}/${media.id}`,
      ].sort(),
    );
  } finally {
    f.close();
  }
});

test("R2 replaces expired, changed, and missing copies using deterministic keys", async (t) => {
  const f = fixture();
  useR2(f.config);
  const bytes = Buffer.from("original");
  const media: Media = {
    id: randomUUID(),
    projectId: f.a.id,
    name: "test",
    mime: "image/jpeg",
    size: bytes.length,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(f.config.mediaDir, media.id), bytes);
  let head: HeadObjectOutput | undefined;
  let uploads = 0;
  const keys: string[] = [];
  t.mock.method(S3Client.prototype, "send", async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      if (!head) throw Object.assign(new Error(), { name: "NotFound" });
      return head;
    }
    assert(command instanceof PutObjectCommand);
    assert(command.input.Body instanceof Readable);
    for await (const chunk of command.input.Body)
      assert.deepEqual(Buffer.from(chunk), bytes);
    uploads++;
    keys.push(command.input.Key!);
    head = {
      ContentLength: bytes.length,
      ContentType: media.mime,
      Metadata: command.input.Metadata,
      LastModified: new Date(),
    };
    return {};
  });
  try {
    await mediaUrl(f.config, media);
    assert(head);
    head.LastModified = new Date(Date.now() - 5 * 86400_000);
    await mediaUrl(f.config, media);
    head.Metadata = {};
    await mediaUrl(f.config, media);
    head.ContentType = "image/png";
    await mediaUrl(f.config, media);
    head.ContentLength = 0;
    await mediaUrl(f.config, media);
    assert.equal(uploads, 5);
    assert.equal(new Set(keys).size, 1);
    assert.deepEqual(readFileSync(join(f.config.mediaDir, media.id)), bytes);
  } finally {
    f.close();
  }
});

test("R2 permission errors, interrupted uploads, and missing or changed local files are safe and secret-free", async (t) => {
  const f = fixture();
  useR2(f.config);
  const media: Media = {
    id: randomUUID(),
    projectId: f.a.id,
    name: "test",
    mime: "image/jpeg",
    size: 4,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(f.config.mediaDir, media.id), "test");
  let failHead = true;
  let uploads = 0;
  let interrupted = true;
  t.mock.method(S3Client.prototype, "send", async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      if (failHead)
        throw new Error("test-secret signed-url private-bucket AccessDenied");
      throw Object.assign(new Error(), { name: "NotFound" });
    }
    assert(command instanceof PutObjectCommand);
    assert(command.input.Body instanceof Readable);
    uploads++;
    for await (const chunk of command.input.Body)
      assert.equal(Buffer.from(chunk).toString(), "test");
    if (interrupted) throw new Error("test-secret interrupted signed-url");
    return {};
  });
  const safeError = (error: unknown) => {
    assert(error instanceof ProviderError);
    assert(error.retryable);
    assert.equal(error.uncertain, false);
    assert(!/test-secret|signed-url|private-bucket/.test(error.message));
    return true;
  };
  try {
    await assert.rejects(() => mediaUrl(f.config, media), safeError);
    assert.equal(uploads, 0);
    failHead = false;
    await assert.rejects(() => mediaUrl(f.config, media), safeError);
    interrupted = false;
    await mediaUrl(f.config, media);
    assert.equal(uploads, 2);
    writeFileSync(join(f.config.mediaDir, media.id), "changed");
    await assert.rejects(() => mediaUrl(f.config, media), safeError);
    unlinkSync(join(f.config.mediaDir, media.id));
    await assert.rejects(() => mediaUrl(f.config, media), safeError);
    await assert.rejects(
      () => mediaUrl(f.config, { ...media, id: "../escape" }),
      safeError,
    );
    assert.equal(uploads, 2);
  } finally {
    f.close();
  }
});

test("R2 signing failures are sanitized and never return an unsigned or tunnel URL", async (t) => {
  const f = fixture();
  useR2(f.config);
  const media: Media = {
    id: randomUUID(),
    projectId: f.a.id,
    name: "test",
    mime: "image/jpeg",
    size: 4,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(f.config.mediaDir, media.id), "test");
  t.mock.method(
    S3Client.prototype,
    "send",
    async function (this: S3Client, command: unknown) {
      if (command instanceof HeadObjectCommand)
        throw Object.assign(new Error(), { name: "NotFound" });
      assert(command instanceof PutObjectCommand);
      assert(command.input.Body instanceof Readable);
      for await (const chunk of command.input.Body)
        assert.equal(Buffer.from(chunk).toString(), "test");
      this.config.credentials = async () => {
        throw new Error("secret-signing-diagnostic");
      };
      return {};
    },
  );
  try {
    await assert.rejects(
      () => mediaUrl(f.config, media),
      (error: unknown) => {
        assert(error instanceof ProviderError);
        assert(error.retryable && !error.uncertain);
        assert(!error.message.includes("secret-signing-diagnostic"));
        return true;
      },
    );
  } finally {
    f.close();
  }
});
