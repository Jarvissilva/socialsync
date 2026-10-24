import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { fixture } from "./helpers.js";
import { inject } from "./inject.js";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";
import { decrypt, encrypt } from "../src/lib/security.js";
import { acquireLock, releaseLock } from "../src/lib/locks.js";
import {
  createProviderApp,
  updateProviderApp,
  deleteProviderApp,
  listProviderApps,
  importProviderApps,
  providerStatuses,
} from "../src/services/providerAppService.js";
import {
  beginConnection,
  completeConnection,
  saveDiscovery,
  usableTokens,
} from "../src/services/accountService.js";
import { listAccounts, savePost } from "../src/services/workspaceService.js";

const response = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200 });
const input = (provider = "youtube", suffix = "one") => ({
  name: `App ${suffix}`,
  provider,
  clientId: `client-${suffix}`,
  clientSecret: `private-${suffix}`,
});

test("global provider app CRUD encrypts secrets, returns only metadata, and rejects immutable/legacy fields", async () => {
  const f = fixture();
  try {
    importProviderApps(f.db, f.config, {});
    const app = createApp(f.db, f.config);
    const local = (
      method: "GET" | "POST" | "PUT" | "DELETE",
      url: string,
      body?: unknown,
    ) =>
      inject(app, method, url, {
        headers: { "X-SocialSync-Client": "1" },
        body,
      });
    const result = await local("POST", "/api/provider-apps", input());
    assert.equal(result.status, 201);
    assert(!result.body.includes("private-one"));
    assert(!result.body.includes('"secret"'));
    const saved = JSON.parse(result.body) as {
      id: string;
      callbackUrl: string;
      linkedAccountCount: number;
    };
    assert.equal(
      saved.callbackUrl,
      `${f.config.callbackOrigin}/public/oauth/youtube/callback`,
    );
    assert.equal(saved.linkedAccountCount, 0);
    const row = f.db
      .prepare("SELECT secret FROM provider_apps WHERE id=?")
      .get(saved.id) as { secret: string };
    assert(!row.secret.includes("private-one"));
    assert.equal(decrypt(row.secret, f.config.encryptionKey), "private-one");
    assert.equal(
      providerStatuses(f.db).find((p) => p.provider === "youtube")?.configured,
      true,
    );
    assert.equal(
      (await local("GET", "/api/provider-apps")).body.includes("private-one"),
      false,
    );
    for (const body of [
      { provider: "meta" },
      { clientId: "other" },
      { clientSecret: "" },
      { name: "" },
    ]) {
      assert.equal(
        (await local("PUT", `/api/provider-apps/${saved.id}`, body)).status,
        400,
      );
    }
    for (const provider of ["facebook", "instagram", "invalid"]) {
      const bad = await local("POST", "/api/provider-apps", input(provider));
      assert.equal(bad.status, 400);
      assert(!bad.body.includes("private-one"));
    }
    const renamed = await local("PUT", `/api/provider-apps/${saved.id}`, {
      name: "Renamed",
      clientSecret: "replacement",
    });
    assert.equal(renamed.status, 200);
    assert(!renamed.body.includes("replacement"));
    assert.equal(listProviderApps(f.db, f.config)[0]?.name, "Renamed");
    assert.equal(
      (await local("DELETE", `/api/provider-apps/${saved.id}`)).status,
      200,
    );
    assert.equal(
      providerStatuses(f.db).find((p) => p.provider === "youtube")?.configured,
      false,
    );
  } finally {
    f.close();
  }
});

test("secret replacement and deletion respect active OAuth, discovery, callback, connection locks and jobs", () => {
  const f = fixture();
  try {
    const app = createProviderApp(f.db, f.config, input());
    const replace = () =>
      updateProviderApp(f.db, f.config, app.id, { clientSecret: "new-secret" });
    const flow = beginConnection(f.db, f.config, "youtube", {
      providerAppId: app.id,
    });
    assert.throws(replace, /in use/);
    assert.throws(() => deleteProviderApp(f.db, app.id), /active/);
    updateProviderApp(f.db, f.config, app.id, { name: "Safe rename" });
    f.db
      .prepare("UPDATE oauth_states SET expiresAt='2000' WHERE id=?")
      .run(flow.state);
    replace();
    const discovery = randomUUID();
    f.db
      .prepare(
        "INSERT INTO discoveries (id,platform,payload,expiresAt,providerAppId) VALUES (?,?,?,?,?)",
      )
      .run(discovery, "youtube", "encrypted", "9999", app.id);
    assert.throws(replace, /in use/);
    assert.throws(() => deleteProviderApp(f.db, app.id), /active/);
    f.db.prepare("DELETE FROM discoveries").run();
    acquireLock(f.db, `provider-app:${app.id}`, "callback");
    assert.throws(replace, /in use/);
    assert.throws(() => deleteProviderApp(f.db, app.id), /active/);
    releaseLock(f.db, `provider-app:${app.id}`, "callback");
    const a = f.account("youtube");
    assert.equal(listProviderApps(f.db, f.config)[0]?.linkedAccountCount, 1);
    acquireLock(f.db, `connection:${a.connectionId}`, "refresh");
    assert.throws(replace, /in use/);
    releaseLock(f.db, `connection:${a.connectionId}`, "refresh");
    const post = savePost(f.db, f.a.id, {
      caption: "test",
      targets: [{ accountId: a.id, format: "video", title: "video" }],
    });
    // Persist a processing job without publishing or requiring media.
    f.db
      .prepare("UPDATE jobs SET status='processing' WHERE postId=?")
      .run(post.id);
    assert.throws(replace, /in use/);
    f.db.prepare("UPDATE jobs SET status='paused'").run();
    replace();
    f.db.prepare("UPDATE connections SET status='disconnected'").run();
    assert.throws(() => deleteProviderApp(f.db, app.id), /linked connections/);
  } finally {
    f.close();
  }
});

for (const provider of ["youtube", "pinterest", "meta"] as const) {
  test(`two ${provider} apps keep OAuth, discovery, refresh and reconnect credentials isolated`, async () => {
    const f = fixture(),
      before = globalThis.fetch;
    try {
      const apps = [
        createProviderApp(f.db, f.config, input(provider, "one")),
        createProviderApp(f.db, f.config, input(provider, "two")),
      ];
      assert.throws(
        () => beginConnection(f.db, f.config, provider, {}),
        /Select a provider app/,
      );
      assert.throws(
        () =>
          beginConnection(f.db, f.config, provider, {
            providerAppId: randomUUID(),
          }),
        /not found/,
      );
      const wrong = createProviderApp(
        f.db,
        f.config,
        input(provider === "youtube" ? "meta" : "youtube", "wrong"),
      );
      assert.throws(
        () =>
          beginConnection(f.db, f.config, provider, {
            providerAppId: wrong.id,
          }),
        /compatible/,
      );
      for (const [index, app] of apps.entries()) {
        const suffix = index === 0 ? "one" : "two";
        const externalId = `identity-${suffix}`;
        let exchanges = 0;
        globalThis.fetch = async (url, init) => {
          const parsed = new URL(String(url));
          if (
            parsed.pathname.endsWith("token") ||
            parsed.pathname.endsWith("access_token")
          ) {
            exchanges++;
            const body = new URLSearchParams(String(init?.body || ""));
            if (provider === "pinterest") {
              assert.equal(
                new Headers(init?.headers).get("Authorization"),
                `Basic ${Buffer.from(`client-${suffix}:private-${suffix}`).toString("base64")}`,
              );
            } else if (provider === "youtube") {
              assert.equal(body.get("client_id"), `client-${suffix}`);
              assert.equal(body.get("client_secret"), `private-${suffix}`);
            } else {
              assert.equal(
                parsed.searchParams.get("client_id"),
                `client-${suffix}`,
              );
              assert.equal(
                parsed.searchParams.get("client_secret"),
                `private-${suffix}`,
              );
            }
            return response({
              access_token: `token-${suffix}`,
              refresh_token: `refresh-${suffix}`,
              expires_in: 3600,
            });
          }
          if (provider === "meta")
            return response({
              data: [
                {
                  id: externalId,
                  name: "Page",
                  access_token: `page-${suffix}`,
                  instagram_business_account: {
                    id: `ig-${suffix}`,
                    username: "ig",
                  },
                },
              ],
            });
          if (provider === "pinterest")
            return response({ id: externalId, username: suffix });
          return response({
            items: [{ id: externalId, snippet: { title: suffix } }],
          });
        };
        const flow = beginConnection(f.db, f.config, provider, {
          providerAppId: app.id,
          projectId: f.a.id,
        });
        assert.equal(
          new URL(flow.url).searchParams.get("client_id"),
          `client-${suffix}`,
        );
        await assert.rejects(
          () =>
            completeConnection(
              f.db,
              f.config,
              provider === "youtube" ? "meta" : "youtube",
              flow.state,
              "code",
            ),
          /expired/,
        );
        const discovery = await completeConnection(
          f.db,
          f.config,
          provider,
          flow.state,
          "code",
        );
        assert.throws(
          () =>
            updateProviderApp(f.db, f.config, app.id, {
              clientSecret: "blocked",
            }),
          /in use/,
        );
        const saved = saveDiscovery(f.db, f.config, discovery, {
          externalIds:
            provider === "meta" ? [externalId, `ig-${suffix}`] : [externalId],
        });
        const account = listAccounts(f.db).find(
          (a) => a.id === saved.accountIds[0],
        )!;
        assert.equal(account.providerAppId, app.id);
        const row = f.db
          .prepare("SELECT connectionId FROM accounts WHERE id=?")
          .get(account.id) as { connectionId: string };
        assert.throws(
          () =>
            beginConnection(f.db, f.config, provider, {
              reconnectAccountId: account.id,
              providerAppId: apps[1 - index]!.id,
            }),
          /original provider app/,
        );
        assert.throws(
          () =>
            beginConnection(f.db, f.config, provider, {
              reconnectAccountId: account.id,
              projectId: f.b.id,
            }),
          /not assigned/,
        );
        const reconnect = beginConnection(f.db, f.config, provider, {
          reconnectAccountId: account.id,
        });
        assert.equal(
          new URL(reconnect.url).searchParams.get("client_id"),
          `client-${suffix}`,
        );
        const replacement = await completeConnection(
          f.db,
          f.config,
          provider,
          reconnect.state,
          "code",
        );
        saveDiscovery(f.db, f.config, replacement, {
          externalIds: [externalId],
        });
        if (provider !== "meta") {
          f.db.prepare("UPDATE connections SET tokens=? WHERE id=?").run(
            encrypt(
              {
                accessToken: "old",
                refreshToken: `refresh-${suffix}`,
                expiresAt: 1,
                accountTokens: {},
              },
              f.config.encryptionKey,
            ),
            row.connectionId,
          );
          acquireLock(f.db, `connection:${row.connectionId}`, "test");
          await usableTokens(f.db, f.config, row.connectionId);
          await usableTokens(f.db, f.config, row.connectionId);
          releaseLock(f.db, `connection:${row.connectionId}`, "test");
          assert.equal(exchanges, 3);
        } else {
          assert.equal(exchanges, 4);
          assert.equal(
            listProviderApps(f.db, f.config).find((a) => a.id === app.id)
              ?.linkedAccountCount,
            2,
          );
        }
      }
      assert.equal(listAccounts(f.db, f.b.id).length, 0);
      // An identity returned by a second app cannot replace an existing account.
      const first = listAccounts(f.db)[0]!;
      const forged = randomUUID();
      f.db
        .prepare(
          "INSERT INTO discoveries (id,platform,payload,expiresAt,providerAppId) VALUES (?,?,?,?,?)",
        )
        .run(
          forged,
          provider,
          encrypt(
            {
              tokens: { accessToken: "other" },
              candidates: [
                {
                  platform: first.platform,
                  externalId: first.externalId,
                  name: "Other",
                  username: "",
                  capabilities: first.capabilities,
                },
              ],
            },
            f.config.encryptionKey,
          ),
          "9999",
          apps[1]!.id,
        );
      assert.throws(
        () =>
          saveDiscovery(f.db, f.config, forged, {
            externalIds: [first.externalId],
          }),
        /another provider app/,
      );
      assert.equal(
        listAccounts(f.db).find((a) => a.id === first.id)?.providerAppId,
        apps[0]!.id,
      );
    } finally {
      globalThis.fetch = before;
      f.close();
    }
  });
}

test("in-progress callback holds the secret lock even after OAuth expiry and rejects replay", async () => {
  const f = fixture(),
    before = globalThis.fetch;
  let finish: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  try {
    const app = createProviderApp(f.db, f.config, input());
    const flow = beginConnection(f.db, f.config, "youtube", {
      providerAppId: app.id,
    });
    globalThis.fetch = async (url) => {
      if (String(url).includes("/token")) {
        await waiting;
        return response({ access_token: "token" });
      }
      return response({
        items: [{ id: "channel", snippet: { title: "Channel" } }],
      });
    };
    const pending = completeConnection(
      f.db,
      f.config,
      "youtube",
      flow.state,
      "code",
    );
    f.db.prepare("UPDATE oauth_states SET expiresAt='2000'").run();
    assert.throws(
      () =>
        updateProviderApp(f.db, f.config, app.id, { clientSecret: "blocked" }),
      /in use/,
    );
    assert.throws(() => deleteProviderApp(f.db, app.id), /active/);
    await assert.rejects(
      () => completeConnection(f.db, f.config, "youtube", flow.state, "code"),
      /expired/,
    );
    finish!();
    await pending;
    assert.equal(
      f.db
        .prepare("SELECT 1 FROM locks WHERE id=?")
        .get(`provider-app:${app.id}:${flow.state}`),
      undefined,
    );
  } finally {
    finish?.();
    globalThis.fetch = before;
    f.close();
  }
});

test("one-time import preserves legacy records, skips incomplete pairs, and never recreates deleted apps", async () => {
  const f = fixture();
  try {
    const account = f.account("facebook");
    f.db.prepare("UPDATE connections SET providerAppId=NULL").run();
    f.db.prepare("DELETE FROM provider_apps").run();
    const state = randomUUID(),
      discovery = randomUUID();
    f.db
      .prepare(
        "INSERT INTO oauth_states (id,platform,verifier,expiresAt) VALUES (?,'facebook','verifier','9999')",
      )
      .run(state);
    f.db
      .prepare(
        "INSERT INTO discoveries (id,platform,payload,expiresAt) VALUES (?,'instagram',?,'9999')",
      )
      .run(
        discovery,
        encrypt(
          { tokens: { accessToken: "legacy" }, candidates: [] },
          f.config.encryptionKey,
        ),
      );
    const tokens = f.db.prepare("SELECT tokens FROM connections").get();
    const env = {
      FACEBOOK_CLIENT_ID: "legacy-id",
      FACEBOOK_CLIENT_SECRET: "legacy-secret",
      INSTAGRAM_CLIENT_ID: "ig-id",
      INSTAGRAM_CLIENT_SECRET: "ig-secret",
      YOUTUBE_CLIENT_ID: "incomplete",
    };
    importProviderApps(f.db, f.config, env);
    const apps = listProviderApps(f.db, f.config);
    assert.deepEqual(
      new Set(apps.map((a) => a.provider)),
      new Set(["meta", "facebook", "instagram"]),
    );
    assert.equal(listAccounts(f.db)[0]?.id, account.id);
    assert.equal(
      listAccounts(f.db)[0]?.providerAppId,
      apps.find((a) => a.provider === "facebook")?.id,
    );
    assert.deepEqual(
      f.db.prepare("SELECT tokens FROM connections").get(),
      tokens,
    );
    assert(
      f.db
        .prepare(
          "SELECT 1 FROM oauth_states WHERE id=? AND providerAppId IS NOT NULL",
        )
        .get(state),
    );
    assert(
      f.db
        .prepare(
          "SELECT 1 FROM discoveries WHERE id=? AND providerAppId IS NOT NULL",
        )
        .get(discovery),
    );
    const meta = apps.find((a) => a.provider === "meta")!;
    deleteProviderApp(f.db, meta.id);
    importProviderApps(f.db, f.config, {
      ...env,
      META_APP_ID: "changed",
      META_APP_SECRET: "changed",
    });
    assert.equal(listProviderApps(f.db, f.config).length, 2);
    const reopened = openDatabase(f.config.databasePath);
    try {
      importProviderApps(reopened, f.config, env);
      assert.equal(listProviderApps(reopened, f.config).length, 2);
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

test("incomplete Meta credentials do not mix fallback halves; unbound accounts retain tokens and require explicit app selection", async () => {
  const f = fixture(),
    before = globalThis.fetch;
  try {
    const account = f.account("youtube");
    f.db.prepare("UPDATE connections SET providerAppId=NULL").run();
    f.db.prepare("DELETE FROM provider_apps").run();
    importProviderApps(f.db, f.config, {
      META_APP_ID: "partial",
      FACEBOOK_CLIENT_ID: "legacy",
      FACEBOOK_CLIENT_SECRET: "secret",
    });
    assert.equal(
      providerStatuses(f.db).find((p) => p.provider === "meta")?.configured,
      false,
    );
    assert.equal(listAccounts(f.db)[0]?.providerAppId, null);
    assert.equal(
      (await usableTokens(f.db, f.config, account.connectionId)).accessToken,
      "test-token",
    );
    const app = createProviderApp(f.db, f.config, input());
    assert.throws(
      () =>
        beginConnection(f.db, f.config, "youtube", {
          reconnectAccountId: account.id,
        }),
      /Select a provider app/,
    );
    beginConnection(f.db, f.config, "youtube", {
      reconnectAccountId: account.id,
      providerAppId: app.id,
    });
    f.db
      .prepare("UPDATE connections SET tokens=? WHERE id=?")
      .run(
        encrypt(
          { accessToken: "old", refreshToken: "refresh", expiresAt: 1 },
          f.config.encryptionKey,
        ),
        account.connectionId,
      );
    globalThis.fetch = async () => {
      throw new Error("Must not contact provider for unbound refresh");
    };
    await assert.rejects(
      () => usableTokens(f.db, f.config, account.connectionId),
      /App setup required/,
    );
  } finally {
    globalThis.fetch = before;
    f.close();
  }
});

test("concurrent API/worker import commits a single configuration set and marker", async () => {
  const f = fixture();
  try {
    const work = () =>
      new Promise<void>((resolve, reject) => {
        const worker = new Worker(
          `
        const { workerData } = require("node:worker_threads");
        (async () => {
          const { tsImport } = await import("tsx/esm/api");
          const { openDatabase } = await tsImport(workerData.databaseModule, workerData.parentURL);
          const { importProviderApps } = await tsImport(workerData.serviceModule, workerData.parentURL);
          const db = openDatabase(workerData.config.databasePath);
          importProviderApps(db, workerData.config, { YOUTUBE_CLIENT_ID: "concurrent", YOUTUBE_CLIENT_SECRET: "private" });
          db.close();
        })().catch((error) => { throw error; });
      `,
          {
            eval: true,
            workerData: {
              config: f.config,
              parentURL: import.meta.url,
              databaseModule: new URL("../src/database.ts", import.meta.url)
                .pathname,
              serviceModule: new URL(
                "../src/services/providerAppService.ts",
                import.meta.url,
              ).pathname,
            },
          },
        );
        worker.once("error", reject);
        worker.once("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`)),
        );
      });
    await Promise.all([work(), work()]);
    assert.equal(listProviderApps(f.db, f.config).length, 1);
    assert(
      f.db
        .prepare("SELECT 1 FROM runtime WHERE id='providerAppsImported'")
        .get(),
    );
  } finally {
    f.close();
  }
});

test("version-one schema upgrades preserve connections and failed imports roll back before retry", () => {
  const f = fixture();
  try {
    const a = f.account("facebook");
    f.db.exec(`
      DROP INDEX connections_app;
      DROP INDEX oauth_states_app;
      DROP INDEX discoveries_app;
      ALTER TABLE connections DROP COLUMN providerAppId;
      ALTER TABLE oauth_states DROP COLUMN providerAppId;
      ALTER TABLE oauth_states DROP COLUMN processing;
      ALTER TABLE discoveries DROP COLUMN providerAppId;
      DROP TABLE provider_apps;
      DELETE FROM migrations WHERE version=2;
    `);
    const reopened = openDatabase(f.config.databasePath);
    try {
      assert.equal(listAccounts(reopened)[0]?.id, a.id);
      assert.equal(listAccounts(reopened)[0]?.providerAppId, null);
      assert.throws(() =>
        importProviderApps(
          reopened,
          { ...f.config, encryptionKey: "bad" },
          { FACEBOOK_CLIENT_ID: "id", FACEBOOK_CLIENT_SECRET: "secret" },
        ),
      );
      assert.equal(listProviderApps(reopened, f.config).length, 0);
      assert.equal(
        reopened
          .prepare("SELECT 1 FROM runtime WHERE id='providerAppsImported'")
          .get(),
        undefined,
      );
      importProviderApps(reopened, f.config, {
        FACEBOOK_CLIENT_ID: "id",
        FACEBOOK_CLIENT_SECRET: "secret",
      });
      assert(listAccounts(reopened)[0]?.providerAppId);
      assert.deepEqual(listAccounts(reopened)[0]?.projectIds, [f.a.id, f.b.id]);
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});

test("multiple accounts can complete OAuth concurrently through the same app", async () => {
  const f = fixture(),
    before = globalThis.fetch;
  let finish: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  try {
    const app = createProviderApp(f.db, f.config, input());
    const flows = [
      beginConnection(f.db, f.config, "youtube", { providerAppId: app.id }),
      beginConnection(f.db, f.config, "youtube", { providerAppId: app.id }),
    ];
    globalThis.fetch = async (url) => {
      if (String(url).includes("/token")) {
        await waiting;
        return response({ access_token: "token" });
      }
      return response({
        items: [{ id: "channel", snippet: { title: "Channel" } }],
      });
    };
    const pending = flows.map((flow) =>
      completeConnection(f.db, f.config, "youtube", flow.state, "code"),
    );
    assert.throws(
      () =>
        updateProviderApp(f.db, f.config, app.id, { clientSecret: "blocked" }),
      /in use/,
    );
    finish!();
    const discoveries = await Promise.all(pending);
    assert.equal(new Set(discoveries).size, 2);
  } finally {
    finish?.();
    globalThis.fetch = before;
    f.close();
  }
});
