import { resolve } from "node:path";
import os from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { z } from "zod";

export interface Config {
  dataDir: string;
  databasePath: string;
  mediaDir: string;
  port: number;
  host: string;
  appOrigin: string;
  callbackOrigin: string;
  publicMediaOrigin: string;
  mediaDelivery: "local" | "r2";
  r2?: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    keyPrefix: string;
  };
  encryptionKey: string;
  maxUploadBytes: number;
  graphVersion: string;
}
export function loadConfig(): Config {
  const dataDir = resolve(
    process.env.DATA_DIR || resolve(os.homedir(), ".local/share/socialsync"),
  );
  const databasePath = resolve(dataDir, "socialsync.sqlite");
  const legacyDatabasePath = resolve(dataDir, "socialdesk.sqlite");
  const encryptionKey = process.env.ENCRYPTION_KEY || "";
  if (!/^[a-f\d]{64}$/i.test(encryptionKey))
    throw new Error(
      "Set ENCRYPTION_KEY to 32 random bytes encoded as 64 hex characters. See .env.example.",
    );
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(process.env.PORT || 3002);
  const host = process.env.HOST || "127.0.0.1";
  const origin = (value: string) => {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Origins must be HTTP(S) URLs without credentials.");
    return url.origin;
  };
  const mediaDelivery = z
    .enum(["local", "r2"])
    .parse(process.env.MEDIA_DELIVERY || "local");
  let r2: Config["r2"];
  if (mediaDelivery === "r2") {
    const required = (name: string) => {
      const value = process.env[name]?.trim();
      if (!value) throw new Error(`Set ${name} when MEDIA_DELIVERY=r2.`);
      return value;
    };
    const endpoint = required("R2_ENDPOINT");
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error(
        "R2_ENDPOINT must be an HTTPS origin without credentials.",
      );
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(
        "R2_ENDPOINT must be an HTTPS origin without credentials.",
      );
    const keyPrefix = process.env.R2_KEY_PREFIX ?? "socialsync";
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(keyPrefix))
      throw new Error(
        "R2_KEY_PREFIX must contain nonempty path segments using letters, numbers, underscores, or hyphens.",
      );
    r2 = {
      endpoint: url.origin,
      bucket: required("R2_BUCKET"),
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      keyPrefix,
    };
  }
  const config: Config = {
    mediaDelivery,
    r2,
    dataDir,
    // Keep existing installations on their original database after the rename.
    databasePath: existsSync(legacyDatabasePath)
      ? legacyDatabasePath
      : databasePath,
    mediaDir: resolve(dataDir, "media"),
    encryptionKey,
    port,
    // Vite proxies to IPv4 loopback. Resolving localhost here can bind only ::1.
    host: host.toLowerCase() === "localhost" ? "127.0.0.1" : host,
    appOrigin: origin(process.env.APP_ORIGIN || "http://127.0.0.1:5174"),
    callbackOrigin: origin(
      process.env.OAUTH_ORIGIN || `http://127.0.0.1:${port}`,
    ),
    publicMediaOrigin: process.env.PUBLIC_MEDIA_ORIGIN
      ? origin(process.env.PUBLIC_MEDIA_ORIGIN)
      : "",
    maxUploadBytes: z.coerce
      .number()
      .int()
      .positive()
      .parse(process.env.MAX_UPLOAD_BYTES || 536870912),
    graphVersion: process.env.META_GRAPH_VERSION || "v25.0",
  };
  mkdirSync(config.mediaDir, { recursive: true, mode: 0o700 });
  return config;
}
