import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { formats, type Platform } from "@social/shared";
import { openDatabase } from "../src/database.js";
import { encrypt } from "../src/lib/security.js";
import type { Config } from "../src/config.js";
import {
  saveProject,
  assignAccount,
  now,
} from "../src/services/workspaceService.js";
export function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "socialdesk-test-"));
  const config: Config = {
    dataDir: dir,
    databasePath: join(dir, "test.sqlite"),
    mediaDir: dir,
    port: 3002,
    host: "127.0.0.1",
    appOrigin: "http://127.0.0.1:5174",
    callbackOrigin: "http://127.0.0.1:3002",
    publicMediaOrigin: "https://media.example.com",
    encryptionKey: "a".repeat(64),
    maxUploadBytes: 1024 * 1024,
    graphVersion: "v25.0",
  };
  const db = openDatabase(config.databasePath);
  const a = saveProject(db, { name: "Alpha" }),
    b = saveProject(db, { name: "Beta" });
  if (!a || !b) throw new Error("Fixture creation failed.");
  function account(
    platform: Platform = "facebook",
    projectIds: string[] = [a!.id, b!.id],
  ) {
    const id = randomUUID(),
      connectionId = randomUUID(),
      externalId = randomUUID();
    db.prepare("INSERT INTO connections VALUES (?,?,?,'connected',?)").run(
      connectionId,
      platform,
      encrypt(
        {
          accessToken: "test-token",
          refreshToken: "test-refresh",
          expiresAt: Date.now() + 86400_000,
          accountTokens: { [externalId]: "page-test-token" },
        },
        config.encryptionKey,
      ),
      now(),
    );
    db.prepare("INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?)").run(
      id,
      connectionId,
      platform,
      externalId,
      `${platform} account`,
      "test",
      JSON.stringify(formats[platform]),
      now(),
    );
    for (const projectId of projectIds) assignAccount(db, projectId, id);
    return { id, connectionId, externalId };
  }
  return {
    db,
    config,
    a,
    b,
    account,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
