import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import os from "node:os";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { fixture } from "./helpers.js";

function localEnvironment(dataDir: string) {
  const previous = process.env;
  process.env = {
    ...previous,
    ENCRYPTION_KEY: "a".repeat(64),
    DATA_DIR: dataDir,
    HOST: "localhost",
    PORT: "3002",
    APP_ORIGIN: "http://localhost:5174",
    OAUTH_ORIGIN: "http://localhost:3002",
    PUBLIC_MEDIA_ORIGIN: "",
    MAX_UPLOAD_BYTES: "1048576",
  };
  return () => {
    process.env = previous;
  };
}

test("data defaults to the user's local share directory and supports overrides", (t) => {
  const f = fixture(),
    restore = localEnvironment(f.config.dataDir);
  try {
    t.mock.method(os, "homedir", () => f.config.dataDir);
    delete process.env.DATA_DIR;
    const expected = join(f.config.dataDir, ".local/share/socialsync");
    for (const value of [undefined, ""]) {
      if (value === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = value;
      const config = loadConfig();
      assert.equal(config.dataDir, expected);
      assert.equal(config.databasePath, join(expected, "socialsync.sqlite"));
      assert.equal(config.mediaDir, join(expected, "media"));
      assert(existsSync(config.mediaDir));
      assert.equal(statSync(config.dataDir).mode & 0o777, 0o700);
    }
    process.env.DATA_DIR = f.config.dataDir;
    assert.equal(loadConfig().dataDir, f.config.dataDir);
    const relativeDir = join(f.config.dataDir, "relative");
    process.env.DATA_DIR = relative(process.cwd(), relativeDir);
    assert.equal(loadConfig().dataDir, relativeDir);
  } finally {
    restore();
    f.close();
  }
});

test("database naming preserves existing installations after the rename", () => {
  const f = fixture(),
    restore = localEnvironment(f.config.dataDir);
  try {
    const databasePath = join(f.config.dataDir, "socialsync.sqlite");
    const legacyDatabasePath = join(f.config.dataDir, "socialdesk.sqlite");
    assert.equal(loadConfig().databasePath, databasePath);
    writeFileSync(legacyDatabasePath, "existing database");
    assert.equal(loadConfig().databasePath, legacyDatabasePath);
    writeFileSync(databasePath, "new database");
    assert.equal(loadConfig().databasePath, legacyDatabasePath);
    assert.equal(readFileSync(legacyDatabasePath, "utf8"), "existing database");
    assert.equal(readFileSync(databasePath, "utf8"), "new database");
  } finally {
    restore();
    f.close();
  }
});

test("localhost binds to IPv4 without changing browser or OAuth origins", () => {
  const f = fixture(),
    restore = localEnvironment(f.config.dataDir);
  try {
    for (const [host, expected] of [
      ["localhost", "127.0.0.1"],
      ["LOCALHOST", "127.0.0.1"],
      ["127.0.0.1", "127.0.0.1"],
      ["::1", "::1"],
    ]) {
      process.env.HOST = host;
      const config = loadConfig();
      assert.equal(config.host, expected);
      assert.equal(config.appOrigin, "http://localhost:5174");
      assert.equal(config.callbackOrigin, "http://localhost:3002");
    }
    delete process.env.HOST;
    assert.equal(loadConfig().host, "127.0.0.1");
  } finally {
    restore();
    f.close();
  }
});

test("a localhost-configured API accepts IPv4 proxy requests for the home page", async () => {
  const f = fixture(),
    restore = localEnvironment(f.config.dataDir);
  const config = loadConfig();
  const server = createApp(f.db, config).listen(0, config.host);
  try {
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    config.port = address.port;
    for (const path of ["health", "projects", "accounts"]) {
      const response = await fetch(
        `http://127.0.0.1:${config.port}/api/${path}`,
        {
          headers: { Host: "localhost:5174" },
        },
      );
      assert.equal(response.status, 200);
      const body: unknown = await response.json();
      if (path === "health")
        assert.deepEqual(body, {
          ok: true,
          workerOnline: false,
          publicMediaReady: false,
        });
      else assert(Array.isArray(body));
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    restore();
    f.close();
  }
});

test("R2 configuration is opt-in and validates required values without echoing secrets", () => {
  const f = fixture(),
    restore = localEnvironment(f.config.dataDir);
  try {
    delete process.env.MEDIA_DELIVERY;
    assert.equal(loadConfig().mediaDelivery, "local");
    process.env.MEDIA_DELIVERY = "r2";
    const values = {
      R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
      R2_BUCKET: "private",
      R2_ACCESS_KEY_ID: "test-access",
      R2_SECRET_ACCESS_KEY: "test-secret",
    };
    Object.assign(process.env, values);
    delete process.env.R2_KEY_PREFIX;
    assert.equal(loadConfig().r2?.keyPrefix, "socialsync");
    for (const name of Object.keys(values)) {
      const previous = process.env[name];
      delete process.env[name];
      assert.throws(loadConfig, new RegExp(name));
      process.env[name] = previous;
    }
    for (const endpoint of [
      "http://insecure",
      "invalid",
      "https://test-secret@host",
      "https://host/path",
      "https://host?secret=value",
    ]) {
      process.env.R2_ENDPOINT = endpoint;
      assert.throws(
        loadConfig,
        (error: unknown) =>
          error instanceof Error &&
          error.message ===
            "R2_ENDPOINT must be an HTTPS origin without credentials.",
      );
    }
    process.env.R2_ENDPOINT = values.R2_ENDPOINT;
    for (const prefix of ["", "/", "../other", "socialsync/", "a//b"]) {
      process.env.R2_KEY_PREFIX = prefix;
      assert.throws(loadConfig, /R2_KEY_PREFIX/);
    }
    process.env.R2_KEY_PREFIX = "cache/socialsync";
    assert.equal(loadConfig().r2?.keyPrefix, "cache/socialsync");
  } finally {
    restore();
    f.close();
  }
});
