import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { mediaSchema, postSchema, projectSchema } from "@socialsync/shared";
import { fixture } from "./helpers.js";
import { createMcpServer } from "../src/mcp/server.js";
import { acquireLock, releaseLock } from "../src/lib/locks.js";
import { saveMediaUpload } from "../src/services/mediaService.js";

async function session(t: TestContext) {
  const f = fixture();
  const server = createMcpServer(f.db, f.config);
  const client = new Client({ name: "socialsync-test", version: "1.0.0" });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
    f.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { f, client };
}
function data(value: Awaited<ReturnType<Client["callTool"]>>) {
  assert(!value.isError, JSON.stringify(value));
  const block = value.content;
  assert(Array.isArray(block));
  const first = block[0];
  assert(
    first &&
      typeof first === "object" &&
      "type" in first &&
      first.type === "text" &&
      "text" in first &&
      typeof first.text === "string",
  );
  return (JSON.parse(first.text) as { data: unknown }).data;
}

test("MCP initializes, advertises actionable schemas and annotations, and manages projects without exposing secrets", async (t) => {
  const { f, client } = await session(t);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 20);
  assert(
    tools.every(
      (tool) => tool.description && tool.inputSchema.type === "object",
    ),
  );
  assert.equal(
    tools.find((tool) => tool.name === "list_projects")?.annotations
      ?.readOnlyHint,
    true,
  );
  assert.equal(
    tools.find((tool) => tool.name === "publish_post")?.annotations
      ?.openWorldHint,
    true,
  );
  assert.equal(
    tools.find((tool) => tool.name === "delete_media")?.annotations
      ?.destructiveHint,
    true,
  );
  const status = data(
    await client.callTool({ name: "get_status", arguments: {} }),
  );
  assert.deepEqual(status, {
    ok: true,
    workerOnline: false,
    publicMediaReady: true,
  });
  const projects = z
    .array(projectSchema)
    .parse(data(await client.callTool({ name: "list_projects" })));
  assert.deepEqual(projects.map((p) => p.id).sort(), [f.a.id, f.b.id].sort());
  const project = projectSchema.parse(
    data(
      await client.callTool({
        name: "create_project",
        arguments: { input: { name: "Gamma", timeZone: "Asia/Kolkata" } },
      }),
    ),
  );
  const updated = projectSchema.parse(
    data(
      await client.callTool({
        name: "update_project",
        arguments: {
          projectId: project.id,
          input: { name: "Gamma edited", timeZone: "UTC" },
        },
      }),
    ),
  );
  assert.equal(updated.name, "Gamma edited");
  const account = f.account();
  const accounts = await client.callTool({
    name: "list_accounts",
    arguments: {},
  });
  assert(
    !/test-token|page-test-token|test-refresh|test-secret|encryptionKey|accessToken/.test(
      JSON.stringify(accounts),
    ),
  );
  await client.callTool({
    name: "remove_account_assignment",
    arguments: { projectId: f.b.id, accountId: account.id },
  });
  assert.deepEqual(
    data(
      await client.callTool({
        name: "list_accounts",
        arguments: { projectId: f.b.id },
      }),
    ),
    [],
  );
  assert.deepEqual(
    data(
      await client.callTool({
        name: "assign_account",
        arguments: { projectId: f.b.id, accountId: account.id },
      }),
    ),
    { ok: true },
  );
  assert.equal(
    (
      await client.callTool({
        name: "list_posts",
        arguments: { projectId: "../escape" },
      })
    ).isError,
    true,
  );
});

test("MCP drafts, scheduling, cancellation and immediate queueing reuse project and assignment checks without calling providers", async (t) => {
  const { f, client } = await session(t);
  const account = f.account("facebook", [f.a.id]);
  const create = async (projectId: string) =>
    client.callTool({
      name: "create_post",
      arguments: {
        projectId,
        input: {
          caption: "Draft",
          targets: [{ accountId: account.id, format: "text" }],
        },
      },
    });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("No real publishing");
  });
  assert.equal((await create(f.b.id)).isError, true);
  let post = postSchema.parse(data(await create(f.a.id)));
  assert.equal(post.state, "draft");
  assert.equal(
    (
      await client.callTool({
        name: "get_post",
        arguments: { projectId: f.b.id, postId: post.id },
      })
    ).isError,
    true,
  );
  assert.deepEqual(
    data(
      await client.callTool({
        name: "list_posts",
        arguments: { projectId: f.b.id },
      }),
    ),
    [],
  );
  post = postSchema.parse(
    data(
      await client.callTool({
        name: "update_post",
        arguments: {
          projectId: f.a.id,
          postId: post.id,
          input: {
            caption: "Updated",
            targets: [{ accountId: account.id, format: "text" }],
          },
        },
      }),
    ),
  );
  assert.equal(post.caption, "Updated");
  assert.equal(
    (
      await client.callTool({
        name: "schedule_post",
        arguments: {
          projectId: f.a.id,
          postId: post.id,
          scheduledAt: new Date(0).toISOString(),
        },
      })
    ).isError,
    true,
  );
  post = postSchema.parse(
    data(
      await client.callTool({
        name: "schedule_post",
        arguments: {
          projectId: f.a.id,
          postId: post.id,
          scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
        },
      }),
    ),
  );
  assert.equal(post.state, "scheduled");
  assert.equal(
    (
      await client.callTool({
        name: "remove_account_assignment",
        arguments: { projectId: f.a.id, accountId: account.id },
      })
    ).isError,
    true,
  );
  post = postSchema.parse(
    data(
      await client.callTool({
        name: "cancel_post",
        arguments: { projectId: f.a.id, postId: post.id },
      }),
    ),
  );
  assert.equal(post.state, "cancelled");
  post = postSchema.parse(
    data(
      await client.callTool({
        name: "publish_post",
        arguments: { projectId: f.a.id, postId: post.id },
      }),
    ),
  );
  assert.equal(post.state, "scheduled");
  assert.equal(calls, 0);
});

test("MCP preserves uncertain destinations until verified resolution, then permits only explicit retry", async (t) => {
  const { f, client } = await session(t);
  const account = f.account();
  const post = postSchema.parse(
    data(
      await client.callTool({
        name: "create_post",
        arguments: {
          projectId: f.a.id,
          input: {
            caption: "Review",
            targets: [{ accountId: account.id, format: "text" }],
          },
        },
      }),
    ),
  );
  const destination = post.targets[0];
  assert(destination);
  f.db
    .prepare(
      "UPDATE jobs SET status='needs_attention', error='Unknown outcome', checkpoint=? WHERE id=?",
    )
    .run(
      JSON.stringify({ stage: "publishing", mediaId: "saved-remote" }),
      destination.id,
    );
  const args = { projectId: f.a.id, postId: post.id, jobId: destination.id };
  assert.equal(
    (await client.callTool({ name: "retry_destination", arguments: args }))
      .isError,
    true,
  );
  assert.equal(
    (
      await client.callTool({
        name: "resolve_destination",
        arguments: { ...args, verified: false, resolution: "not_published" },
      })
    ).isError,
    true,
  );
  assert.equal(
    (
      await client.callTool({
        name: "resolve_destination",
        arguments: {
          ...args,
          projectId: f.b.id,
          verified: true,
          resolution: "not_published",
        },
      })
    ).isError,
    true,
  );
  let result = postSchema.parse(
    data(await client.callTool({ name: "get_post", arguments: args })),
  );
  assert.equal(result.targets[0]?.status, "needs_attention");
  result = postSchema.parse(
    data(
      await client.callTool({
        name: "resolve_destination",
        arguments: { ...args, verified: true, resolution: "not_published" },
      }),
    ),
  );
  assert.equal(result.targets[0]?.status, "failed");
  result = postSchema.parse(
    data(await client.callTool({ name: "retry_destination", arguments: args })),
  );
  assert.equal(result.targets[0]?.status, "scheduled");
  f.db
    .prepare("UPDATE jobs SET status='needs_attention' WHERE id=?")
    .run(destination.id);
  assert.equal(
    (
      await client.callTool({
        name: "resolve_destination",
        arguments: { ...args, verified: true, resolution: "published" },
      })
    ).isError,
    true,
  );
  result = postSchema.parse(
    data(
      await client.callTool({
        name: "resolve_destination",
        arguments: {
          ...args,
          verified: true,
          resolution: "published",
          remoteId: "confirmed-post",
        },
      }),
    ),
  );
  assert.equal(result.targets[0]?.remoteId, "confirmed-post");
  assert.equal(
    (await client.callTool({ name: "retry_destination", arguments: args }))
      .isError,
    true,
  );
});

test("MCP imports original media with content/size checks, cleanup, project isolation, and safe errors", async (t) => {
  const { f, client } = await session(t);
  const sourceDir = mkdtempSync(join(tmpdir(), "socialsync-mcp-input-"));
  t.after(() => rmSync(sourceDir, { recursive: true, force: true }));
  const path = join(sourceDir, "original.png");
  const bytes = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  writeFileSync(path, bytes);
  const upload = (path: string, projectId = f.a.id) =>
    client.callTool({ name: "upload_media", arguments: { projectId, path } });
  const media = mediaSchema.parse(data(await upload(path)));
  assert.equal(media.mime, "image/png");
  assert.equal(media.projectId, f.a.id);
  assert.deepEqual(readFileSync(path), bytes);
  assert.deepEqual(readFileSync(join(f.config.mediaDir, media.id)), bytes);
  assert.deepEqual(
    data(
      await client.callTool({
        name: "list_media",
        arguments: { projectId: f.b.id },
      }),
    ),
    [],
  );
  assert.equal(
    (
      await client.callTool({
        name: "create_post",
        arguments: { projectId: f.b.id, input: { mediaIds: [media.id] } },
      })
    ).isError,
    true,
  );
  assert.equal(
    (
      await client.callTool({
        name: "delete_media",
        arguments: { projectId: f.b.id, mediaId: media.id },
      })
    ).isError,
    true,
  );
  assert.equal(
    (await upload(join(f.config.mediaDir, media.id), f.b.id)).isError,
    true,
  );
  assert.equal((await upload(path, randomUUID())).isError, true);
  const before = readdirSync(f.config.mediaDir).sort();
  const invalid = join(sourceDir, "invalid.png");
  writeFileSync(invalid, "not an image");
  assert.equal((await upload(invalid)).isError, true);
  const oversized = join(sourceDir, "oversized.png");
  writeFileSync(oversized, Buffer.alloc(f.config.maxUploadBytes + 1));
  assert.equal((await upload(oversized)).isError, true);
  assert.equal((await upload("relative.png")).isError, true);
  assert.equal((await upload(sourceDir)).isError, true);
  const link = join(sourceDir, "link.png");
  symlinkSync(path, link);
  assert.equal((await upload(link)).isError, true);
  const missing = await upload(join(sourceDir, "secret-path"));
  assert.equal(missing.isError, true);
  assert(!/secret-path|ENOENT|\/tmp/.test(JSON.stringify(missing)));
  assert.deepEqual(readdirSync(f.config.mediaDir).sort(), before);
  assert.deepEqual(
    data(
      await client.callTool({
        name: "delete_media",
        arguments: { projectId: f.a.id, mediaId: media.id },
      }),
    ),
    { ok: true },
  );
  assert.deepEqual(readFileSync(path), bytes);
});

test("shared HTTP upload registration still rejects mismatched MIME types and removes rejected bytes", () => {
  const f = fixture();
  try {
    const filename = randomUUID();
    const path = join(f.config.mediaDir, filename);
    writeFileSync(path, Buffer.from([255, 216, 255, 219]));
    assert.throws(
      () =>
        saveMediaUpload(f.db, f.a.id, {
          path,
          filename,
          originalname: "bad.png",
          mimetype: "image/png",
          size: 4,
        }),
      /contents do not match/,
    );
    assert(!readdirSync(f.config.mediaDir).includes(filename));
  } finally {
    f.close();
  }
});

test("MCP Pinterest boards respect project assignments and the shared publishing lock, returning no tokens", async (t) => {
  const { f, client } = await session(t);
  const account = f.account("pinterest", [f.a.id]);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(
      JSON.stringify({
        items: [{ id: "board", name: "Ideas", accessToken: "secret" }],
      }),
    );
  });
  const args = { projectId: f.a.id, accountId: account.id };
  assert.equal(
    (
      await client.callTool({
        name: "list_pinterest_boards",
        arguments: { ...args, projectId: f.b.id },
      })
    ).isError,
    true,
  );
  assert(acquireLock(f.db, `connection:${account.connectionId}`, "worker"));
  assert.equal(
    (await client.callTool({ name: "list_pinterest_boards", arguments: args }))
      .isError,
    true,
  );
  assert.equal(calls, 0);
  releaseLock(f.db, `connection:${account.connectionId}`, "worker");
  assert.deepEqual(
    data(
      await client.callTool({ name: "list_pinterest_boards", arguments: args }),
    ),
    [{ id: "board", name: "Ideas" }],
  );
  assert.equal(calls, 1);
  assert(acquireLock(f.db, `connection:${account.connectionId}`, "worker"));
});

test("stdio entrypoint handles initialization, discovery and a harmless call using isolated storage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "socialsync-mcp-stdio-"));
  // Regular file descriptors avoid the sandbox's socketpair restrictions while
  // exercising the real stdio entrypoint and JSON-RPC serialization.
  const input = join(dir, "input.jsonl"),
    output = join(dir, "output.jsonl"),
    errors = join(dir, "stderr.log");
  writeFileSync(
    input,
    [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "stdio-test", version: "1.0.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_projects", arguments: {} },
      },
    ]
      .map((message) => JSON.stringify(message))
      .join("\n") + "\n",
  );
  const descriptors = [
    openSync(input, "r"),
    openSync(output, "w"),
    openSync(errors, "w"),
  ];
  try {
    const child = spawn(process.execPath, ["--import", "tsx", "src/mcp.ts"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        PATH: process.env.PATH,
        DATA_DIR: join(dir, "data"),
        ENCRYPTION_KEY: "a".repeat(64),
        MEDIA_DELIVERY: "local",
      },
      stdio: descriptors,
      timeout: 10_000,
    });
    const [code] = await once(child, "exit");
    assert.equal(code, 0, readFileSync(errors, "utf8"));
    const messages = readFileSync(output, "utf8")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            id?: number;
            result?: {
              serverInfo?: { name: string };
              tools?: unknown[];
              content?: { text: string }[];
            };
            error?: unknown;
          },
      );
    assert(messages.every((message) => !message.error));
    assert.equal(
      messages.find((message) => message.id === 1)?.result?.serverInfo?.name,
      "socialsync",
    );
    assert.equal(
      messages.find((message) => message.id === 2)?.result?.tools?.length,
      20,
    );
    const text = messages.find((message) => message.id === 3)?.result
      ?.content?.[0]?.text;
    assert(text);
    assert.deepEqual(JSON.parse(text), { data: [] });
  } finally {
    descriptors.forEach((fd) => closeSync(fd));
    rmSync(dir, { recursive: true, force: true });
  }
});
