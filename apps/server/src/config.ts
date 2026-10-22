import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
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
  encryptionKey: string;
  maxUploadBytes: number;
  graphVersion: string;
}
export function loadConfig(): Config {
  const dataDir = resolve(process.env.DATA_DIR || "../../data");
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
  const config = {
    dataDir,
    databasePath: resolve(dataDir, "socialdesk.sqlite"),
    mediaDir: resolve(dataDir, "media"),
    encryptionKey,
    port,
    host: process.env.HOST || "127.0.0.1",
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
