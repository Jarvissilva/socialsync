import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { mediaSchema, postSchema } from "@socialsync/shared";
import supertest from "supertest";
import { createApp } from "../src/app.js";
import { fixture } from "./helpers.js";

const headers = {
  "X-SocialSync-Client": "1",
  Accept: "application/json, text/event-stream",
};
const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "socialsync-http-test", version: "1.0.0" },
  },
};

async function httpSession(t: TestContext) {
  const f = fixture();
  const listener = createApp(f.db, f.config).listen(0, "127.0.0.1");
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    f.close();
  });
  await once(listener, "listening");
  const address = listener.address();
  assert(address && typeof address !== "string");
  f.config.port = address.port;
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  const client = new Client({ name: "socialsync-http-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { "X-SocialSync-Client": "1" } },
  });
  t.after(() => client.close());
  await client.connect(transport);
  return { f, client, transport, url };
}

test("app server exposes MCP Streamable HTTP with SDK initialization, discovery, async tool calls and shared project state", async (t) => {
  const { f, client, transport } = await httpSession(t);
  assert.equal(client.getServerVersion()?.name, "socialsync");
  assert.equal(transport.sessionId, undefined);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 20);
  const status = await client.callTool({ name: "get_status" });
  assert.deepEqual(status.structuredContent, {
    data: { ok: true, workerOnline: false, publicMediaReady: true },
  });
  const sourceDir = mkdtempSync(join(tmpdir(), "socialsync-http-media-"));
  t.after(() => rmSync(sourceDir, { recursive: true, force: true }));
  const path = join(sourceDir, "photo.jpg");
  writeFileSync(
    path,
    Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(256 * 1024)]),
  );
  const upload = await client.callTool({
    name: "upload_media",
    arguments: { projectId: f.a.id, path },
  });
  const media = z
    .object({ data: mediaSchema })
    .parse(upload.structuredContent).data;
  assert.equal(media.projectId, f.a.id);
  const saved = await client.callTool({
    name: "create_post",
    arguments: {
      projectId: f.a.id,
      input: { caption: "Created over MCP HTTP", mediaIds: [media.id] },
    },
  });
  const post = z
    .object({ data: postSchema })
    .parse(saved.structuredContent).data;
  assert.equal(post.state, "draft");
  const read = await client.callTool({
    name: "get_post",
    arguments: { projectId: f.a.id, postId: post.id },
  });
  assert.deepEqual(
    z.object({ data: postSchema }).parse(read.structuredContent).data,
    post,
  );
  assert.equal(
    (
      await client.callTool({
        name: "get_post",
        arguments: { projectId: f.b.id, postId: post.id },
      })
    ).isError,
    true,
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
  const api = await supertest(createApp(f.db, f.config))
    .get(`/api/projects/${f.a.id}/posts/${post.id}`)
    .set("Host", `127.0.0.1:${f.config.port}`)
    .expect(200);
  assert.equal((api.body as { id: string }).id, post.id);
  assert.deepEqual(
    f.db
      .prepare("SELECT count(*) count FROM runtime WHERE id='workerHeartbeat'")
      .get(),
    { count: 0 },
  );
});

test("HTTP MCP requests own independent protocol state and preserve shared database state across calls", async (t) => {
  const { f, url } = await httpSession(t);
  const responses = await Promise.all(
    [f.a.id, f.b.id].map(async (projectId) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "create_post",
            arguments: { projectId, input: { caption: projectId } },
          },
        }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/json");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("mcp-session-id"), null);
      const result = (await response.json()) as {
        id: number;
        result: { structuredContent: { data: unknown } };
      };
      assert.equal(result.id, 7);
      return postSchema.parse(result.result.structuredContent.data);
    }),
  );
  assert.equal(responses[0]?.projectId, f.a.id);
  assert.equal(responses[1]?.projectId, f.b.id);
  assert.notEqual(responses[0]?.id, responses[1]?.id);
});

test("MCP remains behind local Host, Origin, cross-site and application-header checks", async () => {
  const f = fixture();
  try {
    const agent = supertest(createApp(f.db, f.config));
    const post = () =>
      agent
        .post("/mcp")
        .set("Host", "127.0.0.1:3002")
        .set(headers)
        .send(initialize);
    await agent
      .post("/mcp")
      .set(headers)
      .set("Host", "public.example.com")
      .send(initialize)
      .expect(403);
    await agent
      .post("/mcp")
      .set("Host", "127.0.0.1:3002")
      .send(initialize)
      .expect(403);
    await post().set("Origin", "https://evil.example").expect(403);
    await post().set("Sec-Fetch-Site", "cross-site").expect(403);
    await agent.get("/mcp").set("Host", "public.example.com").expect(403);
    await post().set("Origin", f.config.appOrigin).expect(200);
    await post().set("Host", "localhost:3002").expect(200);
  } finally {
    f.close();
  }
});

test("MCP SDK returns protocol errors for malformed or oversized requests and unsupported negotiation", async () => {
  const f = fixture();
  try {
    const agent = supertest(createApp(f.db, f.config));
    const post = () =>
      agent.post("/mcp").set("Host", "127.0.0.1:3002").set(headers);
    const malformed = await post()
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400);
    assert.equal(
      (malformed.body as { error: { code: number } }).error.code,
      -32700,
    );
    const invalid = await post().send({ invalid: true }).expect(400);
    assert.equal(
      (invalid.body as { error: { code: number } }).error.code,
      -32700,
    );
    await post().set("Accept", "application/json").send(initialize).expect(406);
    await post()
      .set("Content-Type", "text/plain")
      .send(JSON.stringify(initialize))
      .expect(415);
    await post()
      .send({ ...initialize, padding: "x".repeat(1024 * 1024) })
      .expect(413);
    const unknown = await post()
      .send({ jsonrpc: "2.0", id: 2, method: "missing_method" })
      .expect(200);
    assert.equal(
      (unknown.body as { error: { code: number } }).error.code,
      -32601,
    );
    for (const method of ["get", "delete", "put"] as const) {
      const response = await agent[method]("/mcp")
        .set("Host", "127.0.0.1:3002")
        .set(headers)
        .expect(405);
      assert.equal(response.headers.allow, "POST");
      assert.equal((response.body as { jsonrpc: string }).jsonrpc, "2.0");
    }
    await post().send(initialize).expect(200);
  } finally {
    f.close();
  }
});
