import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers.js";
import {
  beginConnection,
  completeConnection,
  getDiscovery,
  saveDiscovery,
  usableTokens,
  providerStatuses,
} from "../src/services/accountService.js";
import {
  listAccounts,
  assignAccount,
  disconnectAccount,
  savePost,
  schedulePost,
  getPost,
} from "../src/services/workspaceService.js";
import { encrypt, decrypt } from "../src/lib/security.js";
import { acquireLock, releaseLock } from "../src/services/schedulingWorker.js";

function environment() {
  const keys = [
    "META_APP_ID",
    "META_APP_SECRET",
    "FACEBOOK_CLIENT_ID",
    "FACEBOOK_CLIENT_SECRET",
    "INSTAGRAM_CLIENT_ID",
    "INSTAGRAM_CLIENT_SECRET",
  ];
  const previous = keys.map((key) => process.env[key]);
  for (const key of keys) delete process.env[key];
  return () =>
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
}
const response = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200 });
const candidate = (platform: "facebook" | "instagram", externalId: string) => ({
  platform,
  externalId,
  name: `${platform} ${externalId}`,
  username: "demo",
  capabilities: platform === "facebook" ? ["text"] : ["image"],
});
function discovery(
  f: ReturnType<typeof fixture>,
  candidates: ReturnType<typeof candidate>[],
  reconnect: string | null = null,
  project: string | null = null,
  provider = "meta",
) {
  const id = randomUUID();
  f.db.prepare("INSERT INTO discoveries VALUES (?,?,?,?,?,?)").run(
    id,
    provider,
    project,
    reconnect,
    encrypt(
      {
        tokens: {
          accessToken: "user",
          accountTokens: Object.fromEntries(
            candidates.map((c) => [c.externalId, `page-${c.externalId}`]),
          ),
        },
        candidates,
      },
      f.config.encryptionKey,
    ),
    new Date(Date.now() + 60000).toISOString(),
  );
  return id;
}

test("Meta uses one app and scope set, supports the complete legacy credential pair, and enforces project reconnect assignments", () => {
  const restore = environment(),
    f = fixture();
  try {
    process.env.FACEBOOK_CLIENT_ID = "legacy-app";
    process.env.FACEBOOK_CLIENT_SECRET = "legacy-secret";
    assert.equal(
      providerStatuses().find((p) => p.provider === "meta")?.configured,
      true,
    );
    const url = new URL(beginConnection(f.db, f.config, "meta", {}).url);
    assert.equal(url.searchParams.get("client_id"), "legacy-app");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      `${f.config.callbackOrigin}/public/oauth/meta/callback`,
    );
    assert.deepEqual(
      new Set(url.searchParams.get("scope")?.split(",")),
      new Set([
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
        "instagram_basic",
        "instagram_content_publish",
      ]),
    );
    process.env.META_APP_ID = "new-app";
    assert.throws(
      () => beginConnection(f.db, f.config, "meta", {}),
      /META_APP_SECRET/,
    );
    process.env.META_APP_SECRET = "new-secret";
    assert.equal(
      new URL(
        beginConnection(f.db, f.config, "facebook", {}).url,
      ).searchParams.get("client_id"),
      "new-app",
    );
    const a = f.account("facebook", [f.a.id]);
    assert.throws(
      () =>
        beginConnection(f.db, f.config, "meta", {
          projectId: f.b.id,
          reconnectAccountId: a.id,
        }),
      /not assigned/,
    );
  } finally {
    restore();
    f.close();
  }
});

test("Meta discovers Pages and linked professional Instagram accounts, persists only selected destinations and tokens, and hides secrets", async () => {
  const restore = environment(),
    f = fixture(),
    before = globalThis.fetch;
  process.env.META_APP_ID = "app";
  process.env.META_APP_SECRET = "secret";
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("oauth/access_token"))
      return response({ access_token: "secret-user", expires_in: 3600 });
    // Model the real Graph rejection so unsupported fields cannot regress.
    assert(!new URL(url).searchParams.get("fields")?.includes("account_type"));
    return response({
      data: [
        {
          id: "page-one",
          name: "Page One",
          access_token: "secret-page-one",
          instagram_business_account: {
            id: "ig-one",
            username: "creator",
          },
        },
        {
          id: "page-two",
          name: "Page Two",
          access_token: "secret-page-two",
          instagram_business_account: null,
        },
        {
          id: "page-three",
          name: "Page Three",
          access_token: "secret-page-three",
          instagram_business_account: {
            id: "ig-three",
            username: "business",
          },
        },
      ],
    });
  };
  try {
    const pending = beginConnection(f.db, f.config, "meta", {
      projectId: f.a.id,
    });
    const id = await completeConnection(
      f.db,
      f.config,
      "meta",
      pending.state,
      "code",
    );
    const found = getDiscovery(f.db, f.config, id).public;
    assert.equal(found.provider, "meta");
    assert.equal(found.candidates.length, 5);
    assert.deepEqual(
      found.candidates.find((c) => c.externalId === "ig-one")?.capabilities,
      ["image", "carousel", "reel"],
    );
    assert(
      found.candidates.some(
        (c) => c.platform === "facebook" && c.externalId === "page-two",
      ),
    );
    assert(!JSON.stringify(found).includes("secret"));
    assert.equal(
      found.candidates
        .find((c) => c.externalId === "ig-one")
        ?.capabilities.includes("story"),
      false,
    );
    assert.equal(
      found.candidates
        .find((c) => c.externalId === "ig-three")
        ?.capabilities.includes("story"),
      false,
    );
    assert(calls.some((url) => url.includes("instagram_business_account")));
    assert.throws(
      () => saveDiscovery(f.db, f.config, id, { externalIds: ["forged"] }),
      /Select accounts/,
    );
    saveDiscovery(f.db, f.config, id, { externalIds: ["page-two", "ig-one"] });
    const saved = listAccounts(f.db);
    assert.deepEqual(
      new Set(saved.map((a) => a.platform)),
      new Set(["facebook", "instagram"]),
    );
    assert(
      saved.every(
        (a) =>
          a.provider === "meta" &&
          a.projectIds.length === 1 &&
          a.projectIds[0] === f.a.id,
      ),
    );
    assert.equal(listAccounts(f.db, f.b.id).length, 0);
    const rows = f.db.prepare("SELECT * FROM connections").all() as {
      id: string;
      tokens: string;
    }[];
    assert.equal(rows.length, 1);
    assert(!rows[0]!.tokens.includes("secret-user"));
    const tokens = await usableTokens(f.db, f.config, rows[0]!.id);
    assert.equal(tokens.instagramLogin, "facebook");
    assert.deepEqual(tokens.accountTokens, {
      "page-two": "secret-page-two",
      "ig-one": "secret-page-one",
    });
    assert.throws(() => getDiscovery(f.db, f.config, id), /expired/);
  } finally {
    globalThis.fetch = before;
    restore();
    f.close();
  }
});

test("mixed Meta reconnect requires every existing identity, respects locks, preserves assignments/history, and disconnects together", () => {
  const f = fixture();
  try {
    const candidates = [
      candidate("facebook", "page"),
      candidate("instagram", "ig"),
    ];
    const first = saveDiscovery(
      f.db,
      f.config,
      discovery(f, candidates, null, f.a.id),
      { externalIds: ["page", "ig"] },
    );
    const accounts = listAccounts(f.db),
      page = accounts.find((a) => a.platform === "facebook")!,
      ig = accounts.find((a) => a.platform === "instagram")!;
    assignAccount(f.db, f.b.id, ig.id);
    const post = savePost(f.db, f.a.id, {
      caption: "Pending",
      targets: [{ accountId: page.id, format: "text" }],
    });
    schedulePost(f.db, f.a.id, post.id, { immediate: true });
    const connection = f.db
      .prepare("SELECT connectionId FROM accounts WHERE id=?")
      .get(page.id) as { connectionId: string };
    const missing = discovery(f, [candidates[0]!], page.id);
    assert.throws(
      () => saveDiscovery(f.db, f.config, missing, { externalIds: ["page"] }),
      /all destinations/,
    );
    const retry = discovery(
      f,
      [...candidates, candidate("facebook", "unselected")],
      ig.id,
      f.b.id,
    );
    assert(
      acquireLock(f.db, `connection:${connection.connectionId}`, "worker"),
    );
    assert.throws(
      () => saveDiscovery(f.db, f.config, retry, { externalIds: ["ig"] }),
      /in use/,
    );
    releaseLock(f.db, `connection:${connection.connectionId}`, "worker");
    f.db
      .prepare("UPDATE jobs SET status='processing' WHERE postId=?")
      .run(post.id);
    assert.throws(
      () => saveDiscovery(f.db, f.config, retry, { externalIds: ["ig"] }),
      /current publishing/,
    );
    f.db
      .prepare("UPDATE jobs SET status='scheduled' WHERE postId=?")
      .run(post.id);
    saveDiscovery(f.db, f.config, retry, { externalIds: ["ig"] });
    assert.deepEqual(
      new Set(listAccounts(f.db).map((a) => a.id)),
      new Set(first.accountIds),
    );
    assert.deepEqual(
      listAccounts(f.db).find((a) => a.id === page.id)?.projectIds,
      [f.a.id],
    );
    assert.equal(getPost(f.db, f.a.id, post.id).state, "scheduled");
    disconnectAccount(f.db, ig.id);
    assert(listAccounts(f.db).every((a) => a.status === "disconnected"));
    assert.equal(getPost(f.db, f.a.id, post.id).state, "paused");
    saveDiscovery(f.db, f.config, discovery(f, candidates, page.id), {
      externalIds: ["page"],
    });
    assert.equal(getPost(f.db, f.a.id, post.id).state, "paused");
  } finally {
    f.close();
  }
});

test("legacy Instagram keeps its direct reconnect and refresh path and cannot be replaced by Meta selection", async () => {
  const restore = environment(),
    f = fixture(),
    before = globalThis.fetch;
  process.env.INSTAGRAM_CLIENT_ID = "direct-app";
  process.env.INSTAGRAM_CLIENT_SECRET = "direct-secret";
  try {
    const ig = f.account("instagram");
    assert.throws(
      () => beginConnection(f.db, f.config, "instagram", {}),
      /new connections/,
    );
    const url = new URL(
      beginConnection(f.db, f.config, "instagram", {
        reconnectAccountId: ig.id,
      }).url,
    );
    assert.equal(url.hostname, "www.instagram.com");
    assert.equal(
      url.searchParams.get("scope"),
      "instagram_business_basic,instagram_business_content_publish",
    );
    const id = discovery(f, [candidate("instagram", ig.externalId)]);
    assert.throws(
      () => saveDiscovery(f.db, f.config, id, { externalIds: [ig.externalId] }),
      /Instagram Login/,
    );
    assert.equal(listAccounts(f.db)[0]?.provider, "instagram");
    const legacy = discovery(
      f,
      [candidate("instagram", ig.externalId)],
      ig.id,
      null,
      "instagram",
    );
    saveDiscovery(f.db, f.config, legacy, { externalIds: [ig.externalId] });
    assert.equal(listAccounts(f.db)[0]?.id, ig.id);
    f.db
      .prepare("UPDATE connections SET tokens=? WHERE id=?")
      .run(
        encrypt(
          { accessToken: "old-direct", expiresAt: 1, accountTokens: {} },
          f.config.encryptionKey,
        ),
        ig.connectionId,
      );
    globalThis.fetch = async (input) => {
      assert.equal(new URL(String(input)).hostname, "graph.instagram.com");
      return response({ access_token: "refreshed-direct", expires_in: 3600 });
    };
    const tokens = await usableTokens(f.db, f.config, ig.connectionId);
    assert.equal(tokens.accessToken, "refreshed-direct");
    assert.equal(tokens.instagramLogin, undefined);
    const row = f.db
      .prepare("SELECT tokens FROM connections WHERE id=?")
      .get(ig.connectionId) as { tokens: string };
    assert.equal(
      (decrypt(row.tokens, f.config.encryptionKey) as { accessToken: string })
        .accessToken,
      "refreshed-direct",
    );
  } finally {
    globalThis.fetch = before;
    restore();
    f.close();
  }
});

test("a combined reconnect upgrades an existing Facebook authorization without replacing account IDs or assignments", () => {
  const f = fixture();
  try {
    const page = f.account("facebook");
    const id = discovery(
      f,
      [
        candidate("facebook", page.externalId),
        candidate("instagram", "linked"),
      ],
      page.id,
    );
    saveDiscovery(f.db, f.config, id, {
      externalIds: [page.externalId, "linked"],
    });
    const accounts = listAccounts(f.db);
    const saved = accounts.find((a) => a.platform === "facebook")!;
    assert.equal(saved.id, page.id);
    assert.deepEqual(new Set(saved.projectIds), new Set([f.a.id, f.b.id]));
    assert.equal(saved.provider, "meta");
    const related = f.db.prepare("SELECT connectionId FROM accounts").all() as {
      connectionId: string;
    }[];
    assert(related.every((a) => a.connectionId === page.connectionId));
    assert.deepEqual(
      accounts.find((a) => a.platform === "instagram")?.projectIds,
      [],
    );
  } finally {
    f.close();
  }
});

test("in-flight Facebook-only callbacks keep their original permissions and return Page-only discovery", async () => {
  const restore = environment(),
    f = fixture(),
    before = globalThis.fetch;
  process.env.FACEBOOK_CLIENT_ID = "old-app";
  process.env.FACEBOOK_CLIENT_SECRET = "old-secret";
  const state = randomUUID();
  f.db
    .prepare("INSERT INTO oauth_states VALUES (?,?,?,?,?,?)")
    .run(
      state,
      "facebook",
      null,
      null,
      "verifier",
      new Date(Date.now() + 60000).toISOString(),
    );
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("access_token"))
      return response({ access_token: "legacy-token" });
    assert.equal(url.searchParams.get("fields"), "id,name,access_token");
    return response({
      data: [{ id: "page", name: "Page", access_token: "page-token" }],
    });
  };
  try {
    const id = await completeConnection(
      f.db,
      f.config,
      "facebook",
      state,
      "code",
    );
    assert.deepEqual(
      getDiscovery(f.db, f.config, id).public.candidates.map((c) => c.platform),
      ["facebook"],
    );
    saveDiscovery(f.db, f.config, id, { externalIds: ["page"] });
    assert.equal(listAccounts(f.db)[0]?.provider, "facebook");
  } finally {
    globalThis.fetch = before;
    restore();
    f.close();
  }
});

for (const [index, stage] of [
  "Meta code exchange",
  "Meta long-lived token exchange",
  "Meta account discovery",
].entries()) {
  test(`${stage} errors identify the failing step without exposing provider secrets`, async () => {
    const restore = environment(),
      f = fixture(),
      before = globalThis.fetch;
    process.env.META_APP_ID = "test-app";
    process.env.META_APP_SECRET = "private-client-secret";
    // Exercise the localhost callback configuration without any live requests.
    f.config.appOrigin = "http://localhost:5174";
    f.config.callbackOrigin = "http://localhost:3002";
    let calls = 0;
    globalThis.fetch = async (input) => {
      calls++;
      const url = new URL(String(input));
      if (calls === 1)
        assert.equal(
          url.searchParams.get("redirect_uri"),
          "http://localhost:3002/public/oauth/meta/callback",
        );
      if (calls <= index)
        return response({ access_token: "private-user-token" });
      return new Response(
        JSON.stringify({
          error: {
            code: 100,
            error_subcode: 33,
            message: `Do not expose ${url}: private-client-secret private-user-token private-code`,
            error_user_msg: "private-user-token",
          },
          access_token: "private-user-token",
        }),
        { status: 400 },
      );
    };
    try {
      const pending = beginConnection(f.db, f.config, "meta", {});
      assert.equal(
        new URL(pending.url).searchParams.get("redirect_uri"),
        "http://localhost:3002/public/oauth/meta/callback",
      );
      await assert.rejects(
        () =>
          completeConnection(
            f.db,
            f.config,
            "meta",
            pending.state,
            "private-code",
          ),
        (error: unknown) => {
          assert(error instanceof Error);
          assert(
            error.message.startsWith(
              `${stage} failed (HTTP 400; Meta code 100; Meta subcode 33)`,
            ),
          );
          for (const forbidden of [
            "private-",
            "https://",
            "client_secret",
            "access_token",
            "Do not expose",
          ])
            assert(
              !`${error.stack} ${JSON.stringify(error)}`.includes(forbidden),
            );
          return true;
        },
      );
      assert.equal(calls, index + 1);
      assert.equal(listAccounts(f.db).length, 0);
      const row = f.db
        .prepare("SELECT count(*) AS n FROM discoveries")
        .get() as { n: number };
      assert.equal(row.n, 0);
    } finally {
      globalThis.fetch = before;
      restore();
      f.close();
    }
  });
}

test("direct Instagram Login still discovers Business-only Story capability", async () => {
  const restore = environment(),
    f = fixture(),
    before = globalThis.fetch;
  process.env.INSTAGRAM_CLIENT_ID = "direct-app";
  process.env.INSTAGRAM_CLIENT_SECRET = "direct-secret";
  const ig = f.account("instagram");
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/me"))
      return response({ access_token: "direct-token", expires_in: 3600 });
    assert.equal(url.hostname, "graph.instagram.com");
    assert(url.searchParams.get("fields")?.includes("account_type"));
    return response({
      id: ig.externalId,
      username: "business",
      account_type: "BUSINESS",
    });
  };
  try {
    const pending = beginConnection(f.db, f.config, "instagram", {
      reconnectAccountId: ig.id,
    });
    const id = await completeConnection(
      f.db,
      f.config,
      "instagram",
      pending.state,
      "code",
    );
    const candidates = getDiscovery(f.db, f.config, id).public.candidates;
    assert.equal(candidates.length, 1);
    assert(candidates[0]?.capabilities.includes("story"));
    saveDiscovery(f.db, f.config, id, { externalIds: [ig.externalId] });
    assert.equal(listAccounts(f.db)[0]?.id, ig.id);
    assert.equal(listAccounts(f.db)[0]?.provider, "instagram");
    assert(listAccounts(f.db)[0]?.capabilities.includes("story"));
  } finally {
    globalThis.fetch = before;
    restore();
    f.close();
  }
});
