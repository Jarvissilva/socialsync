import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  candidateSchema,
  discoverySchema,
  formats,
  type Provider,
  providerSchema,
  platformSchema,
  type Candidate,
  connectInputSchema,
} from "@socialsync/shared";
import type { Config } from "../config.js";
import {
  accountRowSchema,
  connectionSchema,
  many,
  one,
  type DB,
} from "../database.js";
import { encrypt, decrypt, HttpError } from "../lib/security.js";
import { requireProject, assignAccount, now } from "./workspaceService.js";
import { request, accessTokenResponse } from "./providerHttp.js";

import {
  appCredentials,
  requireProviderApp,
  redirectUri,
} from "./providerAppService.js";
import { acquireLock, releaseLock } from "../lib/locks.js";
export { providerStatuses, redirectUri } from "./providerAppService.js";

export const tokensSchema = z.object({
  instagramLogin: z.enum(["facebook", "instagram"]).optional(),
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  accountTokens: z.record(z.string(), z.string()).default({}),
});
export type Tokens = z.infer<typeof tokensSchema>;
export function beginConnection(
  db: DB,
  config: Config,
  platform: Provider,
  body: unknown,
) {
  const input = connectInputSchema.parse(body);
  return db
    .transaction(() => {
      if (platform === "facebook" && !input.reconnectAccountId)
        platform = "meta";
      let providerAppId = input.providerAppId;
      if (input.projectId) requireProject(db, input.projectId);
      if (input.reconnectAccountId) {
        const a = one(
          db,
          accountRowSchema,
          "SELECT * FROM accounts WHERE id=?",
          input.reconnectAccountId,
        );
        const connection =
          a &&
          one(
            db,
            connectionSchema,
            "SELECT * FROM connections WHERE id=?",
            a.connectionId,
          );
        if (
          connection &&
          platform !== connection.platform &&
          !(platform === "meta" && connection.platform === "facebook")
        )
          throw new HttpError(404, "Account not found for this platform.");
        if (connection?.providerAppId) {
          if (providerAppId && providerAppId !== connection.providerAppId)
            throw new HttpError(
              409,
              "Reconnect using the original provider app.",
            );
          providerAppId = connection.providerAppId;
          platform = providerSchema.parse(connection.platform);
        } else if (
          connection?.platform === "facebook" &&
          platform === "facebook"
        ) {
          const selected = providerAppId
            ? requireProviderApp(db, providerAppId)
            : undefined;
          if (selected?.provider === "meta") platform = "meta";
        }
        if (
          !a ||
          !connection ||
          (platform === "meta"
            ? !["meta", "facebook"].includes(connection.platform)
            : connection.platform !== platform)
        )
          throw new HttpError(404, "Account not found for this platform.");
      }
      if (
        input.projectId &&
        input.reconnectAccountId &&
        !db
          .prepare(
            "SELECT 1 FROM project_accounts WHERE projectId=? AND accountId=?",
          )
          .get(input.projectId, input.reconnectAccountId)
      )
        throw new HttpError(404, "Account is not assigned to this project.");
      if (platform === "instagram" && !input.reconnectAccountId)
        throw new HttpError(
          400,
          "Use Connect Facebook & Instagram for new connections.",
        );
      if (!providerAppId) {
        // Only a new connection can preselect a single app. Legacy unbound accounts
        // require an explicit selection, even when just one compatible app exists.
        const apps = many(
          db,
          z.object({ id: z.string() }),
          "SELECT id FROM provider_apps WHERE provider=?",
          platform,
        );
        if (!input.reconnectAccountId && apps.length === 1)
          providerAppId = apps[0]!.id;
        else
          throw new HttpError(
            409,
            "App setup required. Select a provider app.",
          );
      }
      const client = appCredentials(db, config, providerAppId, platform);
      const state = randomUUID();
      const verifier = randomBytes(32).toString("base64url");
      db.prepare("DELETE FROM oauth_states WHERE expiresAt<?").run(now());
      db.prepare("DELETE FROM discoveries WHERE expiresAt<?").run(now());
      db.prepare(
        "INSERT INTO oauth_states (id,platform,projectId,reconnectAccountId,verifier,expiresAt,providerAppId) VALUES (?,?,?,?,?,?,?)",
      ).run(
        state,
        platform,
        input.projectId || null,
        input.reconnectAccountId || null,
        verifier,
        new Date(Date.now() + 600_000).toISOString(),
        providerAppId,
      );
      const endpoint: Record<Provider, string> = {
        meta: `https://www.facebook.com/${config.graphVersion}/dialog/oauth`,
        instagram: "https://www.instagram.com/oauth/authorize",
        facebook: `https://www.facebook.com/${config.graphVersion}/dialog/oauth`,
        pinterest: "https://www.pinterest.com/oauth/",
        youtube: "https://accounts.google.com/o/oauth2/v2/auth",
      };
      const scopes: Record<Provider, string> = {
        meta: "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish",
        instagram:
          "instagram_business_basic,instagram_business_content_publish",
        facebook: "pages_show_list,pages_read_engagement,pages_manage_posts",
        pinterest: "boards:read,pins:read,pins:write,user_accounts:read",
        youtube:
          "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      };
      const url = new URL(endpoint[platform]);
      for (const [k, v] of Object.entries({
        client_id: client.id,
        redirect_uri: redirectUri(config, platform),
        response_type: "code",
        scope: scopes[platform],
        state,
      }))
        url.searchParams.set(k, v);
      if (platform === "youtube") {
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("prompt", "consent");
      }
      if (platform === "instagram") {
        url.searchParams.set("enable_fb_login", "0");
        url.searchParams.set("force_authentication", "1");
      }
      return { state, url: url.toString() };
    })
    .immediate();
}
const oauthStateSchema = z.object({
  providerAppId: z.string().nullable(),
  id: z.string(),
  platform: z.string(),
  projectId: z.string().nullable(),
  reconnectAccountId: z.string().nullable(),
  verifier: z.string(),
  expiresAt: z.string(),
});
export async function completeConnection(
  db: DB,
  config: Config,
  platform: Provider,
  state: string,
  code: string,
) {
  const pending = one(
    db,
    oauthStateSchema,
    "SELECT * FROM oauth_states WHERE id=? AND platform=? AND expiresAt>? AND processing=0",
    state,
    platform,
    now(),
  );
  if (!pending)
    throw new HttpError(400, "This connection attempt expired. Start again.");
  const owner = randomUUID();
  const lockId = `provider-app:${pending.providerAppId}:${state}`;
  db.transaction(() => {
    requireProviderApp(db, pending.providerAppId, platform);
    if (!acquireLock(db, lockId, owner, 150_000))
      throw new HttpError(
        409,
        "This connection attempt is already in progress.",
      );
    if (
      !db
        .prepare(
          "UPDATE oauth_states SET processing=1 WHERE id=? AND processing=0",
        )
        .run(state).changes
    )
      throw new HttpError(400, "This connection attempt expired. Start again.");
  }).immediate();
  const heartbeat = setInterval(
    () => acquireLock(db, lockId, owner, 150_000),
    5000,
  );
  try {
    const client = appCredentials(db, config, pending.providerAppId, platform);
    const redirect = redirectUri(config, platform);
    let tokens: Tokens;
    if (platform === "facebook" || platform === "meta") {
      const url = new URL(
        `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`,
      );
      for (const [k, v] of Object.entries({
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: redirect,
        code,
      }))
        url.searchParams.set(k, v);
      const short = accessTokenResponse.parse(
        await request(url, {}, false, "Meta code exchange"),
      );
      const longUrl = new URL(
        `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`,
      );
      for (const [k, v] of Object.entries({
        grant_type: "fb_exchange_token",
        client_id: client.id,
        client_secret: client.secret,
        fb_exchange_token: short.access_token,
      }))
        longUrl.searchParams.set(k, v);
      const result = accessTokenResponse.parse(
        await request(longUrl, {}, false, "Meta long-lived token exchange"),
      );
      tokens = {
        accessToken: result.access_token,
        expiresAt: result.expires_in
          ? Date.now() + result.expires_in * 1000
          : undefined,
        accountTokens: {},
      };
    } else if (platform === "instagram") {
      const result = accessTokenResponse.parse(
        await request("https://api.instagram.com/oauth/access_token", {
          method: "POST",
          body: new URLSearchParams({
            client_id: client.id,
            client_secret: client.secret,
            grant_type: "authorization_code",
            redirect_uri: redirect,
            code,
          }),
        }),
      );
      const url = new URL("https://graph.instagram.com/access_token");
      url.searchParams.set("grant_type", "ig_exchange_token");
      url.searchParams.set("client_secret", client.secret);
      url.searchParams.set("access_token", result.access_token);
      const long = accessTokenResponse.parse(await request(url));
      tokens = {
        accessToken: long.access_token,
        expiresAt: Date.now() + (long.expires_in || 5184000) * 1000,
        accountTokens: {},
      };
    } else {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
      });
      const headers: Record<string, string> = {};
      if (platform === "youtube") {
        body.set("client_id", client.id);
        body.set("client_secret", client.secret);
      } else
        headers.Authorization = `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString("base64")}`;
      const result = accessTokenResponse.parse(
        await request(
          platform === "youtube"
            ? "https://oauth2.googleapis.com/token"
            : "https://api.pinterest.com/v5/oauth/token",
          { method: "POST", body, headers },
        ),
      );
      tokens = {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: result.expires_in
          ? Date.now() + result.expires_in * 1000
          : undefined,
        accountTokens: {},
      };
    }
    if (platform === "meta") tokens.instagramLogin = "facebook";
    const candidates: Candidate[] = [];
    const headers = { Authorization: `Bearer ${tokens.accessToken}` };
    if (platform === "facebook" || platform === "meta") {
      const fields =
        platform === "meta"
          ? "id,name,access_token,instagram_business_account{id,username,name}"
          : "id,name,access_token";
      let next: string | undefined =
        `https://graph.facebook.com/${config.graphVersion}/me/accounts?fields=${fields}&limit=100`;
      while (next && candidates.length < 1000) {
        const result: {
          data: {
            id: string;
            name: string;
            access_token: string;
            instagram_business_account?: {
              id: string;
              username: string;
              name?: string;
            } | null;
          }[];
          paging?: { next?: string };
        } = z
          .object({
            data: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                access_token: z.string(),
                instagram_business_account: z
                  .object({
                    id: z.string(),
                    username: z.string(),
                    name: z.string().optional(),
                  })
                  .nullable()
                  .optional(),
              }),
            ),
            paging: z.object({ next: z.string().optional() }).optional(),
          })
          .parse(
            await request(next, { headers }, false, "Meta account discovery"),
          );
        for (const page of result.data) {
          tokens.accountTokens[page.id] = page.access_token;
          candidates.push({
            platform: "facebook",
            externalId: page.id,
            name: page.name,
            username: "",
            capabilities: formats.facebook,
          });
          const ig = page.instagram_business_account;
          if (
            platform === "meta" &&
            ig &&
            !candidates.some(
              (c) => c.platform === "instagram" && c.externalId === ig.id,
            )
          ) {
            tokens.accountTokens[ig.id] = page.access_token;
            candidates.push({
              platform: "instagram",
              externalId: ig.id,
              name: ig.name || ig.username,
              username: ig.username,
              // Facebook Login identifies linked professional accounts, but does
              // not establish Business-only Story eligibility through account_type.
              capabilities: formats.instagram.filter((f) => f !== "story"),
            });
          }
        }
        const following = result.paging?.next;
        next =
          following && new URL(following).hostname === "graph.facebook.com"
            ? following
            : undefined;
      }
    } else if (platform === "instagram") {
      const me = z
        .object({
          id: z.string(),
          user_id: z.union([z.string(), z.number()]).optional(),
          username: z.string(),
          account_type: z.string().optional(),
        })
        .parse(
          await request(
            `https://graph.instagram.com/${config.graphVersion}/me?fields=id,user_id,username,account_type`,
            { headers },
          ),
        );
      candidates.push({
        platform: "instagram",
        externalId: String(me.user_id || me.id),
        name: me.username,
        username: me.username,
        capabilities: formats.instagram.filter(
          (f) => f !== "story" || me.account_type === "BUSINESS",
        ),
      });
    } else if (platform === "pinterest") {
      const me = z
        .object({ id: z.string().optional(), username: z.string() })
        .parse(
          await request("https://api.pinterest.com/v5/user_account", {
            headers,
          }),
        );
      candidates.push({
        platform: "pinterest",
        externalId: me.id || me.username,
        name: me.username,
        username: me.username,
        capabilities: formats.pinterest,
      });
    } else {
      const result = z
        .object({
          items: z.array(
            z.object({
              id: z.string(),
              snippet: z.object({
                title: z.string(),
                customUrl: z.string().optional(),
              }),
            }),
          ),
        })
        .parse(
          await request(
            "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
            { headers },
          ),
        );
      candidates.push(
        ...result.items.map((c) => ({
          platform: "youtube" as const,
          externalId: c.id,
          name: c.snippet.title,
          username: c.snippet.customUrl || "",
          capabilities: formats.youtube,
        })),
      );
    }
    if (!candidates.length)
      throw new HttpError(
        400,
        "No eligible publishing accounts were returned. Check account type and app permissions.",
      );
    const id = randomUUID();
    db.prepare(
      "INSERT INTO discoveries (id,platform,projectId,reconnectAccountId,payload,expiresAt,providerAppId) VALUES (?,?,?,?,?,?,?)",
    ).run(
      id,
      platform,
      pending.projectId,
      pending.reconnectAccountId,
      encrypt({ tokens, candidates }, config.encryptionKey),
      new Date(Date.now() + 600_000).toISOString(),
      pending.providerAppId,
    );
    return id;
  } finally {
    clearInterval(heartbeat);
    db.prepare("DELETE FROM oauth_states WHERE id=?").run(state);
    releaseLock(db, lockId, owner);
  }
}
const discoveryRow = z.object({
  providerAppId: z.string().nullable(),
  id: z.string(),
  platform: providerSchema,
  projectId: z.string().nullable(),
  reconnectAccountId: z.string().nullable(),
  payload: z.string(),
  expiresAt: z.string(),
});
const discoveryPayload = z.object({
  tokens: tokensSchema,
  candidates: z.array(candidateSchema),
});
export function getDiscovery(db: DB, config: Config, id: string) {
  const row = one(
    db,
    discoveryRow,
    "SELECT * FROM discoveries WHERE id=? AND expiresAt>?",
    id,
    now(),
  );
  if (!row)
    throw new HttpError(404, "Account selection expired. Connect again.");
  // Pending discoveries from before the provider split remain selectable.
  const raw = z
    .object({
      tokens: tokensSchema,
      candidates: z.array(
        candidateSchema
          .omit({ platform: true })
          .extend({ platform: platformSchema.optional() }),
      ),
    })
    .parse(decrypt(row.payload, config.encryptionKey));
  const payload = discoveryPayload.parse({
    ...raw,
    candidates: raw.candidates.map((c) => ({
      ...c,
      platform: c.platform || row.platform,
    })),
  });
  return {
    row,
    payload,
    public: discoverySchema.parse({
      ...row,
      provider: row.platform,
      candidates: payload.candidates,
    }),
  };
}
export function saveDiscovery(
  db: DB,
  config: Config,
  id: string,
  body: unknown,
) {
  return db
    .transaction(() => {
      const selected = z
        .object({ externalIds: z.array(z.string()).min(1).max(1000) })
        .parse(body);
      const { row, payload } = getDiscovery(db, config, id);
      requireProviderApp(db, row.providerAppId, row.platform);
      let chosen = payload.candidates.filter((c) =>
        selected.externalIds.includes(c.externalId),
      );
      if (chosen.length !== new Set(selected.externalIds).size)
        throw new HttpError(
          400,
          "Select accounts returned by this connection attempt.",
        );
      const selectedTokens = () => ({
        ...payload.tokens,
        accountTokens: Object.fromEntries(
          Object.entries(payload.tokens.accountTokens).filter(([id]) =>
            chosen.some((c) => c.externalId === id),
          ),
        ),
      });
      let connectionId: string = randomUUID();
      if (row.reconnectAccountId) {
        const existing = one(
          db,
          accountRowSchema,
          "SELECT * FROM accounts WHERE id=?",
          row.reconnectAccountId,
        );
        if (
          !existing ||
          !chosen.some(
            (c) =>
              c.platform === existing.platform &&
              c.externalId === existing.externalId,
          )
        )
          throw new HttpError(
            400,
            "Reconnect the original account, not a different identity.",
          );
        connectionId = existing.connectionId;
        if (
          db
            .prepare("SELECT id FROM locks WHERE id=? AND expiresAt>?")
            .get(`connection:${connectionId}`, now())
        )
          throw new HttpError(
            409,
            "This authorization is in use. Try reconnecting again shortly.",
          );
        if (
          db
            .prepare(
              "SELECT j.id FROM jobs j JOIN accounts a ON a.id=j.accountId WHERE a.connectionId=? AND j.status='processing'",
            )
            .get(connectionId)
        )
          throw new HttpError(
            409,
            "Wait for current publishing to finish before reconnecting this authorization.",
          );
        const related = many(
          db,
          accountRowSchema,
          "SELECT * FROM accounts WHERE connectionId=?",
          connectionId,
        );
        if (
          related.some(
            (a) =>
              !payload.candidates.some(
                (c) =>
                  c.platform === a.platform && c.externalId === a.externalId,
              ),
          )
        )
          throw new HttpError(
            400,
            "Reconnect with access to all destinations sharing this authorization.",
          );
        const connection = one(
          db,
          connectionSchema,
          "SELECT * FROM connections WHERE id=?",
          connectionId,
        );
        if (
          !connection ||
          (row.platform !== connection.platform &&
            !(row.platform === "meta" && connection.platform === "facebook"))
        )
          throw new HttpError(
            400,
            "Reconnect using the original authorization provider.",
          );
        if (
          connection.providerAppId &&
          connection.providerAppId !== row.providerAppId
        )
          throw new HttpError(
            409,
            "Reconnect using the original provider app.",
          );
        // All existing destinations share the replacement authorization and metadata.
        chosen = payload.candidates.filter(
          (c) =>
            chosen.includes(c) ||
            related.some(
              (a) => a.platform === c.platform && a.externalId === c.externalId,
            ),
        );
        db.prepare(
          "UPDATE connections SET tokens=?,status='connected',platform=?,providerAppId=? WHERE id=?",
        ).run(
          encrypt(selectedTokens(), config.encryptionKey),
          row.platform,
          row.providerAppId,
          connectionId,
        );
      } else
        db.prepare(
          "INSERT INTO connections (id,platform,tokens,status,createdAt,providerAppId) VALUES (?,?,?,'connected',?,?)",
        ).run(
          connectionId,
          row.platform,
          encrypt(selectedTokens(), config.encryptionKey),
          now(),
          row.providerAppId,
        );
      const ids: string[] = [];
      for (const candidate of chosen) {
        const existing = one(
          db,
          accountRowSchema,
          "SELECT * FROM accounts WHERE platform=? AND externalId=?",
          candidate.platform,
          candidate.externalId,
        );
        const accountId = existing?.id || randomUUID();
        if (existing) {
          const prior = one(
            db,
            connectionSchema,
            "SELECT * FROM connections WHERE id=?",
            existing.connectionId,
          );
          if (prior?.platform === "instagram" && row.platform !== "instagram")
            throw new HttpError(
              409,
              "This Instagram account uses Instagram Login. Reconnect it from the account library.",
            );
          if (prior?.providerAppId !== row.providerAppId)
            throw new HttpError(
              409,
              "This account uses another provider app. Reconnect it from the account library.",
            );
          if (
            existing.connectionId !== connectionId &&
            db
              .prepare("SELECT 1 FROM accounts WHERE connectionId=? AND id<>?")
              .get(existing.connectionId, existing.id)
          )
            throw new HttpError(
              409,
              "Reconnect this shared authorization from the account library.",
            );
          if (
            db
              .prepare("SELECT id FROM locks WHERE id=? AND expiresAt>?")
              .get(`connection:${existing.connectionId}`, now())
          )
            throw new HttpError(
              409,
              "This account is in use. Try reconnecting again shortly.",
            );
          if (
            db
              .prepare(
                "SELECT id FROM jobs WHERE accountId=? AND status='processing'",
              )
              .get(accountId)
          )
            throw new HttpError(
              409,
              "Wait for current publishing to finish before reconnecting.",
            );
          db.prepare(
            "UPDATE accounts SET connectionId=?,name=?,username=?,capabilities=? WHERE id=?",
          ).run(
            connectionId,
            candidate.name,
            candidate.username,
            JSON.stringify(candidate.capabilities),
            accountId,
          );
        } else
          db.prepare("INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?)").run(
            accountId,
            connectionId,
            candidate.platform,
            candidate.externalId,
            candidate.name,
            candidate.username,
            JSON.stringify(candidate.capabilities),
            now(),
          );
        if (
          row.projectId &&
          selected.externalIds.includes(candidate.externalId)
        )
          assignAccount(db, row.projectId, accountId);
        ids.push(accountId);
      }
      db.prepare("DELETE FROM discoveries WHERE id=?").run(id);
      return { accountIds: ids, projectId: row.projectId };
    })
    .immediate();
}
// Call while holding the connection lock: all assigned projects share one token refresh.
export async function usableTokens(
  db: DB,
  config: Config,
  connectionId: string,
): Promise<Tokens> {
  const connection = one(
    db,
    connectionSchema,
    "SELECT * FROM connections WHERE id=?",
    connectionId,
  );
  if (!connection || connection.status !== "connected")
    throw new HttpError(409, "Reconnect this account.");
  let tokens = tokensSchema.parse(
    decrypt(connection.tokens, config.encryptionKey),
  );
  if (tokens.expiresAt && tokens.expiresAt < Date.now() + 300_000) {
    const client = appCredentials(
      db,
      config,
      connection.providerAppId,
      providerSchema.parse(connection.platform),
    );
    if (connection.platform === "instagram") {
      const url = new URL("https://graph.instagram.com/refresh_access_token");
      url.searchParams.set("grant_type", "ig_refresh_token");
      url.searchParams.set("access_token", tokens.accessToken);
      const result = accessTokenResponse.parse(await request(url));
      tokens = {
        ...tokens,
        accessToken: result.access_token,
        expiresAt: Date.now() + (result.expires_in || 5184000) * 1000,
      };
    } else if (
      (connection.platform === "youtube" ||
        connection.platform === "pinterest") &&
      tokens.refreshToken
    ) {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      });
      const headers: Record<string, string> = {};
      if (connection.platform === "youtube") {
        body.set("client_id", client.id);
        body.set("client_secret", client.secret);
      } else
        headers.Authorization = `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString("base64")}`;
      const result = accessTokenResponse.parse(
        await request(
          connection.platform === "youtube"
            ? "https://oauth2.googleapis.com/token"
            : "https://api.pinterest.com/v5/oauth/token",
          { method: "POST", body, headers },
        ),
      );
      tokens = {
        ...tokens,
        accessToken: result.access_token,
        refreshToken: result.refresh_token || tokens.refreshToken,
        expiresAt: Date.now() + (result.expires_in || 3600) * 1000,
      };
    } else {
      db.prepare("UPDATE connections SET status='expired' WHERE id=?").run(
        connectionId,
      );
      throw new HttpError(
        409,
        "Authorization expired. Reconnect this account.",
      );
    }
    db.prepare("UPDATE connections SET tokens=? WHERE id=?").run(
      encrypt(tokens, config.encryptionKey),
      connectionId,
    );
  }
  return connection.platform === "meta"
    ? { ...tokens, instagramLogin: "facebook" }
    : tokens;
}
