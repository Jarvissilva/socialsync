import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inject } from "./inject.js";
import { createApp } from "../src/app.js";
import {
  savePost,
  schedulePost,
  listPosts,
  listAccounts,
  removeAssignment,
  disconnectAccount,
  cancelPost,
  saveProject,
  getPost,
  retryJob,
  resolveJob,
} from "../src/services/workspaceService.js";
import { signature, encrypt, decrypt } from "../src/lib/security.js";
import { fixture } from "./helpers.js";

test("project data is isolated while a connected account is shared", () => {
  const f = fixture();
  try {
    const account = f.account();
    const post = savePost(f.db, f.a.id, {
      title: "Alpha only",
      caption: "Hello",
      targets: [{ accountId: account.id, format: "text" }],
    });
    assert.equal(listPosts(f.db, f.b.id).length, 0);
    assert.throws(() => getPost(f.db, f.b.id, post.id), /not found/);
    assert.equal(
      listAccounts(f.db, f.a.id)[0]?.id,
      listAccounts(f.db, f.b.id)[0]?.id,
    );
    const mediaId = randomUUID();
    f.db
      .prepare("INSERT INTO media VALUES (?,?,?,?,?,?)")
      .run(
        mediaId,
        f.a.id,
        "private.jpg",
        "image/jpeg",
        100,
        new Date().toISOString(),
      );
    assert.throws(
      () => savePost(f.db, f.b.id, { mediaIds: [mediaId] }),
      /not found/,
    );
  } finally {
    f.close();
  }
});
test("accounts must be explicitly assigned and pending posts prevent removal", () => {
  const f = fixture();
  try {
    const account = f.account("facebook", [f.a.id]);
    assert.throws(
      () =>
        savePost(f.db, f.b.id, {
          targets: [{ accountId: account.id, format: "text" }],
        }),
      /assigned/,
    );
    const p = savePost(f.db, f.a.id, {
      caption: "Hello",
      targets: [{ accountId: account.id, format: "text" }],
    });
    schedulePost(f.db, f.a.id, p.id, { immediate: true });
    assert.throws(() => removeAssignment(f.db, f.a.id, account.id), /pending/);
    cancelPost(f.db, f.a.id, p.id);
    removeAssignment(f.db, f.a.id, account.id);
    assert.equal(listAccounts(f.db, f.a.id).length, 0);
    assert.equal(listAccounts(f.db).length, 1);
  } finally {
    f.close();
  }
});
test("disconnect pauses all projects without removing their content", () => {
  const f = fixture();
  try {
    const account = f.account();
    for (const project of [f.a, f.b]) {
      const p = savePost(f.db, project.id, {
        caption: project.name,
        targets: [{ accountId: account.id, format: "text" }],
      });
      schedulePost(f.db, project.id, p.id, { immediate: true });
    }
    disconnectAccount(f.db, account.id);
    assert.equal(listPosts(f.db, f.a.id)[0]?.state, "paused");
    assert.equal(listPosts(f.db, f.b.id)[0]?.state, "paused");
    assert.equal(listAccounts(f.db)[0]?.status, "disconnected");
    assert.equal(listPosts(f.db, f.b.id)[0]?.caption, "Beta");
    assert.throws(
      () =>
        retryJob(
          f.db,
          f.a.id,
          listPosts(f.db, f.a.id)[0]!.id,
          listPosts(f.db, f.a.id)[0]!.targets[0]!.id,
        ),
      /reconnect/,
    );
  } finally {
    f.close();
  }
});
test("incomplete drafts are allowed but publishing requires valid content", () => {
  const f = fixture();
  try {
    const account = f.account("youtube");
    const p = savePost(f.db, f.a.id, {
      targets: [{ accountId: account.id, format: "video" }],
    });
    assert.equal(p.state, "draft");
    assert.throws(
      () => schedulePost(f.db, f.a.id, p.id, { immediate: true }),
      /media|video|title/,
    );
    assert.throws(() => saveProject(f.db, { name: "alpha" }), /already exists/);
    assert.throws(() =>
      saveProject(f.db, { name: "Timezone", timeZone: "Invalid/Zone" }),
    );
  } finally {
    f.close();
  }
});
test("unknown outcomes require explicit verification before retry", () => {
  const f = fixture();
  try {
    const account = f.account();
    const p = savePost(f.db, f.a.id, {
      caption: "Hello",
      targets: [{ accountId: account.id, format: "text" }],
    });
    schedulePost(f.db, f.a.id, p.id, { immediate: true });
    const job = p.targets[0]!;
    f.db
      .prepare(
        "UPDATE jobs SET status='needs_attention',error='Unknown response',checkpoint=? WHERE id=?",
      )
      .run(JSON.stringify({ stage: "publishing" }), job.id);
    assert.throws(() => retryJob(f.db, f.a.id, p.id, job.id), /uncertain/);
    assert.throws(() =>
      resolveJob(f.db, f.a.id, p.id, job.id, {
        verified: false,
        resolution: "not_published",
      }),
    );
    resolveJob(f.db, f.a.id, p.id, job.id, {
      verified: true,
      resolution: "not_published",
    });
    assert.equal(retryJob(f.db, f.a.id, p.id, job.id).state, "scheduled");
  } finally {
    f.close();
  }
});
test("HTTP endpoints enforce project ownership and protect the local dashboard", async () => {
  const f = fixture();
  try {
    const app = createApp(f.db, f.config);
    const account = f.account();
    const p = savePost(f.db, f.a.id, {
      caption: "Private",
      targets: [{ accountId: account.id, format: "text" }],
    });
    assert.equal(
      (await inject(app, "GET", `/api/projects/${f.b.id}/posts/${p.id}`))
        .status,
      404,
    );
    assert.equal(
      (
        await inject(app, "GET", "/api/projects", {
          headers: { host: "public-tunnel.example.com" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await inject(app, "POST", "/api/projects", {
          body: { name: "No CSRF header" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await inject(app, "POST", "/api/projects", {
          headers: {
            "x-socialsync-client": "1",
            origin: "https://hostile.example",
          },
          body: { name: "Bad origin" },
        })
      ).status,
      403,
    );
    const accounts = await inject(app, "GET", "/api/accounts");
    assert.equal(accounts.status, 200);
    assert(!accounts.body.includes("test-token"));
    assert(!accounts.body.includes("tokens"));
    assert.equal(
      (
        await inject(
          app,
          "POST",
          `/api/projects/${f.b.id}/posts/${p.id}/cancel`,
          { headers: { "x-socialsync-client": "1" }, body: {} },
        )
      ).status,
      404,
    );
  } finally {
    f.close();
  }
});
test("media delivery requires a valid project-bound expiring signature", async () => {
  const f = fixture();
  try {
    const app = createApp(f.db, f.config);
    const id = randomUUID();
    const expires = String(Date.now() - 1000);
    assert.equal(
      (
        await inject(
          app,
          "GET",
          `/public/media/${f.a.id}/${id}?expires=${expires}&signature=${signature(`${f.a.id}:${id}:${expires}`, f.config.encryptionKey)}`,
          { headers: { host: "public.example.com" } },
        )
      ).status,
      403,
    );
    const future = String(Date.now() + 10000);
    assert.equal(
      (
        await inject(
          app,
          "GET",
          `/public/media/${f.b.id}/${id}?expires=${future}&signature=${signature(`${f.a.id}:${id}:${future}`, f.config.encryptionKey)}`,
        )
      ).status,
      403,
    );
  } finally {
    f.close();
  }
});
test("credentials are authenticated encrypted data", () => {
  const key = "1".repeat(64);
  const encrypted = encrypt({ accessToken: "secret" }, key);
  assert(!encrypted.includes("secret"));
  assert.deepEqual(decrypt(encrypted, key), { accessToken: "secret" });
  assert.throws(() => decrypt(encrypted, "2".repeat(64)));
});
