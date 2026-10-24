import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  connectionProviders,
  providerNames,
  providerSchema,
  providerAppSchema,
  providerAppInputSchema,
  providerAppUpdateSchema,
  type Provider,
} from "@socialsync/shared";
import { many, one, type DB } from "../database.js";
import type { Config } from "../config.js";
import { decrypt, encrypt, HttpError } from "../lib/security.js";

const now = () => new Date().toISOString();
const appRow = z.object({
  id: z.string(),
  name: z.string(),
  provider: providerSchema,
  clientId: z.string(),
  secret: z.string(),
  createdAt: z.string(),
});
export function redirectUri(config: Config, provider: Provider) {
  return `${config.callbackOrigin}/public/oauth/${provider}/callback`;
}
export function requireProviderApp(
  db: DB,
  id: string | null,
  provider?: Provider,
) {
  if (!id)
    throw new HttpError(
      409,
      "App setup required. Select a provider app to reconnect this account.",
    );
  const app = one(db, appRow, "SELECT * FROM provider_apps WHERE id=?", id);
  if (!app) throw new HttpError(404, "Provider app not found.");
  if (provider && app.provider !== provider)
    throw new HttpError(400, "Select a compatible provider app.");
  return app;
}
export function appCredentials(
  db: DB,
  config: Config,
  id: string | null,
  provider: Provider,
) {
  const app = requireProviderApp(db, id, provider);
  return {
    id: app.clientId,
    secret: z.string().parse(decrypt(app.secret, config.encryptionKey)),
  };
}
export function listProviderApps(db: DB, config: Config) {
  return many(
    db,
    appRow,
    "SELECT * FROM provider_apps ORDER BY createdAt,id",
  ).map((app) =>
    providerAppSchema.parse({
      id: app.id,
      name: app.name,
      provider: app.provider,
      clientId: app.clientId,
      createdAt: app.createdAt,
      callbackUrl: redirectUri(config, app.provider),
      linkedAccountCount: z
        .object({ count: z.number() })
        .parse(
          db
            .prepare(
              "SELECT count(*) count FROM accounts a JOIN connections c ON c.id=a.connectionId WHERE c.providerAppId=?",
            )
            .get(app.id),
        ).count,
    }),
  );
}
export function providerStatuses(db: DB) {
  return connectionProviders.map((provider) => {
    const configured = Boolean(
      db.prepare("SELECT 1 FROM provider_apps WHERE provider=?").get(provider),
    );
    return {
      provider,
      configured,
      missing: configured ? [] : ["Provider app"],
    };
  });
}
export function createProviderApp(db: DB, config: Config, body: unknown) {
  const input = providerAppInputSchema.parse(body),
    id = randomUUID();
  db.prepare(
    "INSERT INTO provider_apps (id,name,provider,clientId,secret,createdAt) VALUES (?,?,?,?,?,?)",
  ).run(
    id,
    input.name,
    input.provider,
    input.clientId,
    encrypt(input.clientSecret, config.encryptionKey),
    now(),
  );
  return listProviderApps(db, config).find((app) => app.id === id)!;
}
function activeFlows(db: DB, id: string) {
  return (
    db
      .prepare(
        "SELECT 1 FROM oauth_states WHERE providerAppId=? AND expiresAt>? UNION ALL SELECT 1 FROM discoveries WHERE providerAppId=? AND expiresAt>?",
      )
      .get(id, now(), id, now()) ||
    db
      .prepare("SELECT 1 FROM locks WHERE (id=? OR id GLOB ?) AND expiresAt>?")
      .get(`provider-app:${id}`, `provider-app:${id}:*`, now())
  );
}
export function updateProviderApp(
  db: DB,
  config: Config,
  id: string,
  body: unknown,
) {
  const input = providerAppUpdateSchema.parse(body);
  return db
    .transaction(() => {
      requireProviderApp(db, id);
      if (
        input.clientSecret !== undefined &&
        (activeFlows(db, id) ||
          db
            .prepare(
              "SELECT 1 FROM connections c JOIN locks l ON l.id='connection:'||c.id WHERE c.providerAppId=? AND l.expiresAt>?",
            )
            .get(id, now()) ||
          db
            .prepare(
              "SELECT 1 FROM jobs j JOIN accounts a ON a.id=j.accountId JOIN connections c ON c.id=a.connectionId WHERE c.providerAppId=? AND j.status='processing'",
            )
            .get(id))
      )
        throw new HttpError(
          409,
          "This provider app is in use. Finish account connections, discovery, publishing, or refresh before replacing its secret.",
        );
      if (input.name !== undefined)
        db.prepare("UPDATE provider_apps SET name=? WHERE id=?").run(
          input.name,
          id,
        );
      if (input.clientSecret !== undefined)
        db.prepare("UPDATE provider_apps SET secret=? WHERE id=?").run(
          encrypt(input.clientSecret, config.encryptionKey),
          id,
        );
      return listProviderApps(db, config).find((app) => app.id === id)!;
    })
    .immediate();
}
export function deleteProviderApp(db: DB, id: string) {
  db.transaction(() => {
    requireProviderApp(db, id);
    if (
      db.prepare("SELECT 1 FROM connections WHERE providerAppId=?").get(id) ||
      activeFlows(db, id)
    )
      throw new HttpError(
        409,
        "This provider app has linked connections or active account connections. It cannot be deleted.",
      );
    db.prepare("DELETE FROM oauth_states WHERE providerAppId=?").run(id);
    db.prepare("DELETE FROM discoveries WHERE providerAppId=?").run(id);
    db.prepare("DELETE FROM provider_apps WHERE id=?").run(id);
  }).immediate();
}

// The marker and bindings commit together. API and worker startup serialize here.
export function importProviderApps(
  db: DB,
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
) {
  db.transaction(() => {
    if (
      db.prepare("SELECT 1 FROM runtime WHERE id='providerAppsImported'").get()
    )
      return;
    const pairs: Record<Provider, [string, string]> = {
      meta:
        !env.META_APP_ID && !env.META_APP_SECRET
          ? ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"]
          : ["META_APP_ID", "META_APP_SECRET"],
      facebook: ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"],
      instagram: ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"],
      pinterest: ["PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET"],
      youtube: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
    };
    for (const provider of providerSchema.options) {
      const [idKey, secretKey] = pairs[provider],
        clientId = env[idKey],
        secret = env[secretKey];
      if (!clientId || !secret) continue;
      const id = randomUUID();
      db.prepare(
        "INSERT INTO provider_apps (id,name,provider,clientId,secret,createdAt) VALUES (?,?,?,?,?,?)",
      ).run(
        id,
        `Imported ${providerNames[provider]}`,
        provider,
        clientId,
        encrypt(secret, config.encryptionKey),
        now(),
      );
      db.prepare(
        "UPDATE connections SET providerAppId=? WHERE platform=? AND providerAppId IS NULL",
      ).run(id, provider);
      for (const table of ["oauth_states", "discoveries"])
        db.prepare(
          `UPDATE ${table} SET providerAppId=? WHERE platform=? AND providerAppId IS NULL AND expiresAt>?`,
        ).run(id, provider, now());
    }
    db.prepare(
      "INSERT INTO runtime (id,value) VALUES ('providerAppsImported',?)",
    ).run(now());
  }).immediate();
}
