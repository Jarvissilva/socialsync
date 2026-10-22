import { randomUUID } from "node:crypto";
import { targetInputSchema } from "@social/shared";
import { type DB, one, jobSchema, accountRowSchema } from "../database.js";
import type { Config } from "../config.js";
import { usableTokens } from "./accountService.js";
import { getPost, getMedia, now } from "./workspaceService.js";
import {
  publish,
  checkpointSchema,
  type PublishContext,
  type PublishResult,
} from "./publishingService.js";
import { ProviderError } from "./providerHttp.js";
import { HttpError } from "../lib/security.js";

export function acquireLock(db: DB, id: string, owner: string, ttl = 30_000) {
  return (
    db
      .prepare(
        "INSERT INTO locks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expiresAt=excluded.expiresAt WHERE locks.expiresAt<? OR locks.owner=excluded.owner",
      )
      .run(id, owner, new Date(Date.now() + ttl).toISOString(), now())
      .changes === 1
  );
}
export function releaseLock(db: DB, id: string, owner: string) {
  db.prepare("DELETE FROM locks WHERE id=? AND owner=?").run(id, owner);
}
export type Publisher = (context: PublishContext) => Promise<PublishResult>;
export async function processNext(
  db: DB,
  config: Config,
  owner: string,
  publisher: Publisher = publish,
): Promise<boolean> {
  const job = db.transaction(() => {
    const candidate = one(
      db,
      jobSchema,
      "SELECT * FROM jobs WHERE status='scheduled' AND availableAt IS NOT NULL AND availableAt<=? ORDER BY availableAt,id LIMIT 1",
      now(),
    );
    if (!candidate) return undefined;
    const a = one(
      db,
      accountRowSchema,
      "SELECT * FROM accounts WHERE id=?",
      candidate.accountId,
    );
    if (!a || !acquireLock(db, `connection:${a.connectionId}`, owner))
      return undefined;
    const stamp = new Date(Date.now() + 30_000).toISOString();
    db.prepare(
      "UPDATE jobs SET status='processing',leaseUntil=?,leaseToken=?,attempts=attempts+1 WHERE id=? AND status='scheduled'",
    ).run(stamp, owner, candidate.id);
    return { ...candidate, leaseToken: owner, connectionId: a.connectionId };
  })();
  if (!job) return false;
  const attempt = randomUUID();
  db.prepare("INSERT INTO attempts (id,jobId,startedAt) VALUES (?,?,?)").run(
    attempt,
    job.id,
    now(),
  );
  const heartbeat = setInterval(() => {
    acquireLock(db, `connection:${job.connectionId}`, owner);
    db.prepare(
      "UPDATE jobs SET leaseUntil=? WHERE id=? AND leaseToken=? AND status='processing'",
    ).run(new Date(Date.now() + 30_000).toISOString(), job.id, owner);
  }, 5000);
  const update = (
    status: string,
    error: string | null,
    availableAt: string | null,
    remoteId?: string,
    url?: string,
  ) =>
    db
      .prepare(
        "UPDATE jobs SET status=?,error=?,availableAt=?,remoteId=COALESCE(?,remoteId),url=COALESCE(?,url),leaseUntil=NULL,leaseToken=NULL WHERE id=? AND leaseToken=?",
      )
      .run(
        status,
        error,
        availableAt,
        remoteId || null,
        url || null,
        job.id,
        owner,
      );
  try {
    if (
      !db
        .prepare(
          "SELECT 1 FROM project_accounts WHERE projectId=? AND accountId=?",
        )
        .get(job.projectId, job.accountId)
    )
      throw new HttpError(
        409,
        "Account is no longer assigned to this project.",
      );
    const a = one(
      db,
      accountRowSchema,
      "SELECT * FROM accounts WHERE id=?",
      job.accountId,
    );
    if (!a) throw new HttpError(404, "Account not found.");
    const tokens = await usableTokens(db, config, a.connectionId);
    const post = getPost(db, job.projectId, job.postId);
    const checkpoint = checkpointSchema.parse(JSON.parse(job.checkpoint));
    const result = await publisher({
      config,
      account: a,
      tokens,
      target: targetInputSchema.parse(JSON.parse(job.input)),
      caption: post.caption,
      media: post.mediaIds.map((id) => getMedia(db, job.projectId, id)),
      checkpoint,
      save: (value) => {
        Object.assign(checkpoint, value);
        const written = db
          .prepare(
            "UPDATE jobs SET checkpoint=?,remoteId=COALESCE(?,remoteId),url=COALESCE(?,url) WHERE id=? AND leaseToken=? AND status='processing'",
          )
          .run(
            JSON.stringify(value),
            value.remoteId || null,
            value.url || null,
            job.id,
            owner,
          );
        if (!written.changes)
          throw new ProviderError(
            "Publishing lease was lost. Check the platform before retrying.",
            false,
            true,
          );
      },
    });
    if (result.pending) {
      checkpoint.pollCount = (checkpoint.pollCount || 0) + 1;
      db.prepare(
        "UPDATE jobs SET checkpoint=? WHERE id=? AND leaseToken=?",
      ).run(JSON.stringify(checkpoint), job.id, owner);
      if (checkpoint.pollCount > 720)
        update(
          "needs_attention",
          "Processing is taking longer than expected. Check the platform.",
          null,
        );
      else
        update(
          "scheduled",
          null,
          new Date(Date.now() + 15_000).toISOString(),
          result.remoteId,
          result.url,
        );
    } else update("published", null, null, result.remoteId, result.url);
    db.prepare("UPDATE attempts SET finishedAt=?,outcome=? WHERE id=?").run(
      now(),
      result.pending ? "processing" : "published",
      attempt,
    );
  } catch (error) {
    const row = one(db, jobSchema, "SELECT * FROM jobs WHERE id=?", job.id);
    const cp = checkpointSchema.parse(JSON.parse(row?.checkpoint || "{}"));
    const known = error instanceof ProviderError || error instanceof HttpError;
    const message = known
      ? error.message
      : "An unexpected publishing response requires review. Check the platform before retrying.";
    cp.retryCount = (cp.retryCount || 0) + 1;
    db.prepare("UPDATE jobs SET checkpoint=? WHERE id=? AND leaseToken=?").run(
      JSON.stringify(cp),
      job.id,
      owner,
    );
    if (error instanceof ProviderError && error.auth) {
      db.prepare("UPDATE connections SET status='expired' WHERE id=?").run(
        job.connectionId,
      );
      update("paused", message, null);
    } else if (
      error instanceof ProviderError &&
      error.retryable &&
      !error.uncertain &&
      cp.retryCount < 5
    )
      update(
        "scheduled",
        message,
        new Date(
          Date.now() + Math.min(900_000, 30_000 * 2 ** cp.retryCount),
        ).toISOString(),
      );
    else
      update(
        !known || (error instanceof ProviderError && error.uncertain)
          ? "needs_attention"
          : error instanceof HttpError
            ? "paused"
            : "failed",
        message,
        null,
      );
    db.prepare(
      "UPDATE attempts SET finishedAt=?,outcome=?,error=? WHERE id=?",
    ).run(now(), "error", message, attempt);
  } finally {
    clearInterval(heartbeat);
    releaseLock(db, `connection:${job.connectionId}`, owner);
  }
  return true;
}
export function recoverJobs(db: DB) {
  db.transaction(() => {
    const stale = db
      .prepare(
        "SELECT * FROM jobs WHERE status='processing' AND (leaseUntil IS NULL OR leaseUntil<?)",
      )
      .all(now());
    for (const item of stale) {
      const j = jobSchema.parse(item);
      const cp = checkpointSchema.parse(JSON.parse(j.checkpoint));
      const a = one(
        db,
        accountRowSchema,
        "SELECT * FROM accounts WHERE id=?",
        j.accountId,
      );
      const safe =
        cp.stage === "done" ||
        cp.stage === "processing" ||
        cp.stage === "uploading" ||
        Boolean(cp.mediaId && cp.stage !== "publishing") ||
        (cp.stage === "publishing" && a?.platform === "instagram");
      db.prepare(
        "UPDATE jobs SET status=?,error=?,availableAt=?,leaseUntil=NULL,leaseToken=NULL WHERE id=?",
      ).run(
        safe ? "scheduled" : "needs_attention",
        safe
          ? null
          : "Publishing was interrupted. Check the platform before creating another post.",
        safe ? now() : null,
        j.id,
      );
      db.prepare(
        "UPDATE attempts SET finishedAt=?,outcome='interrupted' WHERE jobId=? AND finishedAt IS NULL",
      ).run(now(), j.id);
    }
  })();
}
export function startWorker(db: DB, config: Config) {
  const owner = randomUUID();
  if (!acquireLock(db, "worker", owner))
    throw new Error("Another publishing worker is already running.");
  recoverJobs(db);
  db.prepare(
    "UPDATE jobs SET status='needs_attention',error='Missed while the worker was offline.' WHERE status='scheduled' AND checkpoint='{}' AND availableAt<?",
  ).run(new Date(Date.now() - 30_000).toISOString());
  let running = false;
  let stopping = false;
  let current: Promise<void> = Promise.resolve();
  const heartbeat = () => {
    if (!acquireLock(db, "worker", owner)) {
      stopping = true;
      return;
    }
    db.prepare(
      "INSERT INTO runtime VALUES ('workerHeartbeat',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    ).run(now());
  };
  heartbeat();
  const pulse = setInterval(heartbeat, 5000);
  const tick = () => {
    if (running || stopping) return;
    running = true;
    current = (async () => {
      try {
        recoverJobs(db);
        while (!stopping && (await processNext(db, config, owner))) {
          /* Drain due work serially; provider processing returns to the durable queue. */
        }
      } catch {
        console.error(
          "Worker tick failed; durable jobs will be checked again.",
        );
      } finally {
        running = false;
      }
    })();
  };
  const timer = setInterval(tick, 15_000);
  tick();
  return async () => {
    stopping = true;
    clearInterval(timer);
    await current;
    clearInterval(pulse);
    releaseLock(db, "worker", owner);
    db.prepare("DELETE FROM runtime WHERE id='workerHeartbeat'").run();
  };
}
