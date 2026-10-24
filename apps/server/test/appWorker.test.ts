import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { startAppWorker } from "../src/services/appWorker.js";
import { acquireLock } from "../src/services/schedulingWorker.js";

function lock(f: ReturnType<typeof fixture>) {
  return f.db.prepare("SELECT owner FROM locks WHERE id='worker'").get() as
    { owner: string } | undefined;
}

test("app startup starts publishing immediately and shutdown releases ownership", async (t) => {
  const f = fixture();
  t.mock.method(console, "log", () => {});
  let stop: (() => Promise<void>) | undefined;
  try {
    stop = startAppWorker(f.db, f.config);
    assert(lock(f)?.owner);
    assert(
      f.db.prepare("SELECT value FROM runtime WHERE id='workerHeartbeat'").get(),
    );
    await stop();
    assert.equal(lock(f), undefined);
    assert.equal(
      f.db.prepare("SELECT value FROM runtime WHERE id='workerHeartbeat'").get(),
      undefined,
    );
  } finally {
    await stop?.();
    f.close();
  }
});

test("app startup stays available without replacing an active worker", async (t) => {
  const f = fixture();
  t.mock.timers.enable({ apis: ["setInterval"] });
  const warn = t.mock.method(console, "warn", () => {});
  const log = t.mock.method(console, "log", () => {});
  let stop: (() => Promise<void>) | undefined;
  try {
    assert(acquireLock(f.db, "worker", "existing-worker"));
    stop = startAppWorker(f.db, f.config);
    t.mock.timers.tick(5000);
    assert.equal(lock(f)?.owner, "existing-worker");
    assert.equal(warn.mock.callCount(), 1);
    assert.equal(log.mock.callCount(), 0);
    // The same database remains available to API requests during contention.
    assert.deepEqual(f.db.prepare("SELECT count(*) AS n FROM projects").get(), {
      n: 2,
    });
  } finally {
    await stop?.();
    t.mock.timers.reset();
    f.close();
  }
});

test("app worker retries an expired lease and starts exactly one worker", async (t) => {
  const f = fixture();
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.mock.method(console, "warn", () => {});
  const log = t.mock.method(console, "log", () => {});
  let stop: (() => Promise<void>) | undefined;
  try {
    assert(acquireLock(f.db, "worker", "previous-process"));
    stop = startAppWorker(f.db, f.config);
    assert.equal(lock(f)?.owner, "previous-process");
    f.db
      .prepare("UPDATE locks SET expiresAt=? WHERE id='worker'")
      .run(new Date(Date.now() - 1000).toISOString());
    t.mock.timers.tick(1000);
    const owner = lock(f)?.owner;
    assert(owner);
    assert.notEqual(owner, "previous-process");
    assert.equal(log.mock.callCount(), 1);
    t.mock.timers.tick(3000);
    assert.equal(lock(f)?.owner, owner);
    assert.equal(log.mock.callCount(), 1);
    await stop();
    assert.equal(lock(f), undefined);
    assert.equal(
      f.db.prepare("SELECT 1 FROM runtime WHERE id='workerHeartbeat'").get(),
      undefined,
    );
  } finally {
    await stop?.();
    t.mock.timers.reset();
    f.close();
  }
});

test("shutdown cancels acquisition retries and preserves the other worker's heartbeat", async (t) => {
  const f = fixture();
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.mock.method(console, "warn", () => {});
  const log = t.mock.method(console, "log", () => {});
  let stop: (() => Promise<void>) | undefined;
  try {
    assert(acquireLock(f.db, "worker", "existing-worker"));
    f.db
      .prepare("INSERT INTO runtime VALUES ('workerHeartbeat',?)")
      .run("existing-heartbeat");
    stop = startAppWorker(f.db, f.config);
    await stop();
    f.db
      .prepare("UPDATE locks SET expiresAt=? WHERE id='worker'")
      .run(new Date(Date.now() - 1000).toISOString());
    t.mock.timers.tick(5000);
    assert.equal(lock(f)?.owner, "existing-worker");
    assert.equal(log.mock.callCount(), 0);
    assert.deepEqual(
      f.db
        .prepare("SELECT value FROM runtime WHERE id='workerHeartbeat'")
        .get(),
      { value: "existing-heartbeat" },
    );
  } finally {
    await stop?.();
    t.mock.timers.reset();
    f.close();
  }
});

test("app startup still surfaces unexpected database failures", (t) => {
  const f = fixture();
  const warn = t.mock.method(console, "warn", () => {});
  try {
    f.db.exec("DROP TABLE locks");
    assert.throws(() => startAppWorker(f.db, f.config), /no such table: locks/);
    assert.equal(warn.mock.callCount(), 0);
  } finally {
    f.close();
  }
});
