import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fixture } from "./helpers.js";
import {
  beginConnection,
  completeConnection,
  getDiscovery,
  saveDiscovery,
  usableTokens,
  tokensSchema,
} from "../src/services/accountService.js";
import {
  listAccounts,
  disconnectAccount,
} from "../src/services/workspaceService.js";
import { one, connectionSchema } from "../src/database.js";
import { decrypt, encrypt } from "../src/lib/security.js";
import { acquireLock, releaseLock } from "../src/services/schedulingWorker.js";

test("OAuth discovers identities and saves one shared account with a project assignment", async () => {
  const f = fixture(),
    fetchBefore = globalThis.fetch,
    idBefore = process.env.YOUTUBE_CLIENT_ID,
    secretBefore = process.env.YOUTUBE_CLIENT_SECRET;
  process.env.YOUTUBE_CLIENT_ID = "test-client";
  process.env.YOUTUBE_CLIENT_SECRET = "test-secret";
  globalThis.fetch = async (input) =>
    new Response(
      JSON.stringify(
        String(input).includes("/token")
          ? {
              access_token: "oauth-token",
              refresh_token: "refresh-token",
              expires_in: 3600,
            }
          : {
              items: [
                {
                  id: "channel-one",
                  snippet: { title: "My channel", customUrl: "@channel" },
                },
              ],
            },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    const pending = beginConnection(f.db, f.config, "youtube", {
      projectId: f.a.id,
    });
    assert.equal(
      new URL(pending.url).searchParams.get("redirect_uri"),
      "http://127.0.0.1:3002/public/oauth/youtube/callback",
    );
    const discoveryId = await completeConnection(
      f.db,
      f.config,
      "youtube",
      pending.state,
      "test-code",
    );
    const discovery = getDiscovery(f.db, f.config, discoveryId).public;
    assert.equal(discovery.projectId, f.a.id);
    assert(!JSON.stringify(discovery).includes("oauth-token"));
    saveDiscovery(f.db, f.config, discoveryId, {
      externalIds: ["channel-one"],
    });
    const a = listAccounts(f.db);
    assert.equal(a.length, 1);
    assert.deepEqual(a[0]?.projectIds, [f.a.id]);
    assert.equal(listAccounts(f.db, f.b.id).length, 0);
    await assert.rejects(
      () =>
        completeConnection(
          f.db,
          f.config,
          "youtube",
          pending.state,
          "test-code",
        ),
      /expired/,
    );
  } finally {
    globalThis.fetch = fetchBefore;
    if (idBefore === undefined) delete process.env.YOUTUBE_CLIENT_ID;
    else process.env.YOUTUBE_CLIENT_ID = idBefore;
    if (secretBefore === undefined) delete process.env.YOUTUBE_CLIENT_SECRET;
    else process.env.YOUTUBE_CLIENT_SECRET = secretBefore;
    f.close();
  }
});
test("reconnection preserves the library identity and assignments in every project", () => {
  const f = fixture();
  try {
    const a = f.account();
    disconnectAccount(f.db, a.id);
    const id = randomUUID();
    const payload = {
      tokens: {
        accessToken: "replacement",
        accountTokens: { [a.externalId]: "replacement-page" },
      },
      candidates: [
        {
          externalId: a.externalId,
          name: "Renamed Page",
          username: "",
          capabilities: ["text"],
        },
      ],
    };
    f.db
      .prepare("INSERT INTO discoveries VALUES (?,?,?,?,?,?)")
      .run(
        id,
        "facebook",
        null,
        a.id,
        encrypt(payload, f.config.encryptionKey),
        new Date(Date.now() + 60000).toISOString(),
      );
    assert(acquireLock(f.db, `connection:${a.connectionId}`, "busy"));
    assert.throws(
      () => saveDiscovery(f.db, f.config, id, { externalIds: [a.externalId] }),
      /in use/,
    );
    releaseLock(f.db, `connection:${a.connectionId}`, "busy");
    saveDiscovery(f.db, f.config, id, { externalIds: [a.externalId] });
    assert.equal(listAccounts(f.db).length, 1);
    assert.equal(listAccounts(f.db)[0]?.id, a.id);
    assert.equal(listAccounts(f.db, f.a.id)[0]?.status, "connected");
    assert.equal(listAccounts(f.db, f.b.id)[0]?.name, "Renamed Page");
  } finally {
    f.close();
  }
});
test("refreshing a shared authorization persists the new token for subsequent projects", async () => {
  const f = fixture(),
    previous = globalThis.fetch;
  let calls = 0;
  const clientBefore = process.env.YOUTUBE_CLIENT_ID,
    secretBefore = process.env.YOUTUBE_CLIENT_SECRET;
  process.env.YOUTUBE_CLIENT_ID = "client";
  process.env.YOUTUBE_CLIENT_SECRET = "secret";
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }),
      { status: 200 },
    );
  };
  try {
    const a = f.account("youtube");
    f.db
      .prepare("UPDATE connections SET tokens=? WHERE id=?")
      .run(
        encrypt(
          {
            accessToken: "old",
            refreshToken: "refresh",
            expiresAt: 1,
            accountTokens: {},
          },
          f.config.encryptionKey,
        ),
        a.connectionId,
      );
    await usableTokens(f.db, f.config, a.connectionId);
    await usableTokens(f.db, f.config, a.connectionId);
    assert.equal(calls, 1);
    const connection = one(
      f.db,
      connectionSchema,
      "SELECT * FROM connections WHERE id=?",
      a.connectionId,
    );
    assert(connection);
    assert.equal(
      tokensSchema.parse(decrypt(connection.tokens, f.config.encryptionKey))
        .accessToken,
      "fresh-token",
    );
    assert.equal(
      one(
        f.db,
        z.object({ n: z.number() }),
        "SELECT count(*) n FROM project_accounts WHERE accountId=?",
        a.id,
      )?.n,
      2,
    );
  } finally {
    globalThis.fetch = previous;
    if (clientBefore === undefined) delete process.env.YOUTUBE_CLIENT_ID;
    else process.env.YOUTUBE_CLIENT_ID = clientBefore;
    if (secretBefore === undefined) delete process.env.YOUTUBE_CLIENT_SECRET;
    else process.env.YOUTUBE_CLIENT_SECRET = secretBefore;
    f.close();
  }
});
