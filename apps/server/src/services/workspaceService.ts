import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  projectInputSchema,
  projectSchema,
  mediaSchema,
  accountSchema,
  postSchema,
  postInputSchema,
  targetInputSchema,
  formatSchema,
  validateContent,
  scheduleSchema,
  type Post,
  type Account,
} from "@social/shared";
import {
  one,
  many,
  accountRowSchema,
  jobSchema,
  connectionSchema,
  type DB,
  type Job,
} from "../database.js";
import { HttpError } from "../lib/security.js";

export const now = () => new Date().toISOString();
const projectRow = projectInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
});
const postRow = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  caption: z.string(),
  mediaIds: z.string(),
  scheduledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const countSchema = z.object({ n: z.number() });
function visibleJobStatus(job: Job): Job["status"] {
  if (job.status !== "scheduled") return job.status;
  const checkpoint = z
    .object({ stage: z.string().optional() })
    .parse(JSON.parse(job.checkpoint));
  return checkpoint.stage ? "processing" : job.status;
}
export function requireProject(db: DB, projectId: string) {
  const project = one(
    db,
    projectRow,
    "SELECT * FROM projects WHERE id=?",
    projectId,
  );
  if (!project) throw new HttpError(404, "Project not found.");
  return project;
}
export function listProjects(db: DB) {
  return many(
    db,
    projectRow,
    "SELECT * FROM projects ORDER BY createdAt,id",
  ).map((project) =>
    projectSchema.parse({
      ...project,
      accountCount:
        one(
          db,
          countSchema,
          "SELECT count(*) n FROM project_accounts WHERE projectId=?",
          project.id,
        )?.n ?? 0,
      scheduledCount:
        one(
          db,
          countSchema,
          "SELECT count(DISTINCT postId) n FROM jobs WHERE projectId=? AND status='scheduled' AND availableAt IS NOT NULL",
          project.id,
        )?.n ?? 0,
    }),
  );
}
export function saveProject(db: DB, body: unknown, id?: string) {
  const input = projectInputSchema.parse(body);
  if (id) requireProject(db, id);
  if (
    db
      .prepare("SELECT id FROM projects WHERE normalizedName=? AND id<>?")
      .get(input.name.toLocaleLowerCase("en"), id || "")
  )
    throw new HttpError(409, "A project with this name already exists.");
  const projectId = id || randomUUID();
  if (id)
    db.prepare(
      "UPDATE projects SET name=?,normalizedName=?,timeZone=? WHERE id=?",
    ).run(input.name, input.name.toLocaleLowerCase("en"), input.timeZone, id);
  else
    db.prepare("INSERT INTO projects VALUES (?,?,?,?,?)").run(
      projectId,
      input.name,
      input.name.toLocaleLowerCase("en"),
      input.timeZone,
      now(),
    );
  return listProjects(db).find((p) => p.id === projectId);
}
export function listAccounts(db: DB, projectId?: string): Account[] {
  if (projectId) requireProject(db, projectId);
  return many(
    db,
    accountRowSchema,
    `SELECT a.* FROM accounts a ${projectId ? "JOIN project_accounts p ON p.accountId=a.id WHERE p.projectId=?" : ""} ORDER BY a.createdAt,a.id`,
    ...(projectId ? [projectId] : []),
  ).map((a) => {
    const c = one(
      db,
      connectionSchema,
      "SELECT * FROM connections WHERE id=?",
      a.connectionId,
    );
    return accountSchema.parse({
      ...a,
      provider: c?.platform || a.platform,
      status: c?.status || "disconnected",
      capabilities: z.array(formatSchema).parse(JSON.parse(a.capabilities)),
      projectIds: many(
        db,
        z.object({ projectId: z.string() }),
        "SELECT projectId FROM project_accounts WHERE accountId=?",
        a.id,
      ).map((r) => r.projectId),
    });
  });
}
export function assignAccount(db: DB, projectId: string, accountId: string) {
  return db.transaction(() => {
    requireProject(db, projectId);
    if (!db.prepare("SELECT id FROM accounts WHERE id=?").get(accountId))
      throw new HttpError(404, "Account not found.");
    db.prepare("INSERT OR IGNORE INTO project_accounts VALUES (?,?)").run(
      projectId,
      accountId,
    );
  })();
}
export function removeAssignment(db: DB, projectId: string, accountId: string) {
  return db.transaction(() => {
    requireProject(db, projectId);
    if (
      db
        .prepare(
          "SELECT id FROM jobs WHERE projectId=? AND accountId=? AND (status IN ('processing','paused','needs_attention') OR (availableAt IS NOT NULL AND status='scheduled')) LIMIT 1",
        )
        .get(projectId, accountId)
    )
      throw new HttpError(
        409,
        "Resolve or cancel pending posts using this account before removing it from the project.",
      );
    db.prepare(
      "DELETE FROM project_accounts WHERE projectId=? AND accountId=?",
    ).run(projectId, accountId);
  })();
}
export function disconnectAccount(db: DB, accountId: string) {
  return db.transaction(() => {
    const account = one(
      db,
      accountRowSchema,
      "SELECT * FROM accounts WHERE id=?",
      accountId,
    );
    if (!account) throw new HttpError(404, "Account not found.");
    const busy = db
      .prepare(
        "SELECT j.id FROM jobs j JOIN accounts a ON a.id=j.accountId WHERE a.connectionId=? AND j.status='processing'",
      )
      .get(account.connectionId);
    if (busy)
      throw new HttpError(
        409,
        "Publishing is in progress. Wait for it to finish before disconnecting.",
      );
    db.prepare(
      "UPDATE connections SET status='disconnected',tokens='' WHERE id=?",
    ).run(account.connectionId);
    db.prepare(
      "UPDATE jobs SET status='paused',error='Account disconnected. Reconnect and explicitly retry.' WHERE accountId IN (SELECT id FROM accounts WHERE connectionId=?) AND status='scheduled' AND availableAt IS NOT NULL",
    ).run(account.connectionId);
  })();
}
export function listMedia(db: DB, projectId: string) {
  requireProject(db, projectId);
  return many(
    db,
    mediaSchema,
    "SELECT * FROM media WHERE projectId=? ORDER BY createdAt DESC",
    projectId,
  );
}
export function getMedia(db: DB, projectId: string, id: string) {
  const media = one(
    db,
    mediaSchema,
    "SELECT * FROM media WHERE id=? AND projectId=?",
    id,
    projectId,
  );
  if (!media) throw new HttpError(404, "Media not found in this project.");
  return media;
}
export function deleteMedia(
  db: DB,
  projectId: string,
  id: string,
  mediaDir: string,
) {
  getMedia(db, projectId, id);
  if (
    db
      .prepare(
        "SELECT id FROM posts WHERE projectId=? AND EXISTS (SELECT 1 FROM json_each(posts.mediaIds) WHERE value=?)",
      )
      .get(projectId, id)
  )
    throw new HttpError(
      409,
      "This media is used by a post. Remove it from the post first.",
    );
  db.prepare("DELETE FROM media WHERE id=? AND projectId=?").run(id, projectId);
  try {
    unlinkSync(join(mediaDir, id));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
}
export function getPost(db: DB, projectId: string, id: string): Post {
  const row = one(
    db,
    postRow,
    "SELECT * FROM posts WHERE id=? AND projectId=?",
    id,
    projectId,
  );
  if (!row) throw new HttpError(404, "Post not found in this project.");
  const jobs = many(
    db,
    jobSchema,
    "SELECT * FROM jobs WHERE postId=? AND projectId=? ORDER BY rowid",
    id,
    projectId,
  );
  let state: Post["state"] = "draft";
  if (row.scheduledAt) {
    const statuses = jobs.map(visibleJobStatus);
    if (statuses.includes("processing")) state = "processing";
    else if (statuses.every((s) => s === "published")) state = "published";
    else if (statuses.includes("scheduled")) state = "scheduled";
    else if (statuses.includes("published")) state = "partial";
    else if (statuses.includes("needs_attention")) state = "needs_attention";
    else if (statuses.includes("paused")) state = "paused";
    else if (statuses.every((s) => s === "cancelled")) state = "cancelled";
    else state = "failed";
  }
  return postSchema.parse({
    ...row,
    state,
    mediaIds: JSON.parse(row.mediaIds),
    targets: jobs.map((j) => {
      const a = one(
        db,
        accountRowSchema,
        "SELECT * FROM accounts WHERE id=?",
        j.accountId,
      );
      return {
        ...targetInputSchema.parse(JSON.parse(j.input)),
        id: j.id,
        platform: a?.platform,
        accountName: a?.name,
        status: visibleJobStatus(j),
        error: j.error,
        remoteId: j.remoteId,
        url: j.url,
        attempts: j.attempts,
      };
    }),
  });
}
export function listPosts(db: DB, projectId: string) {
  requireProject(db, projectId);
  return many(
    db,
    z.object({ id: z.string() }),
    "SELECT id FROM posts WHERE projectId=? ORDER BY createdAt DESC",
    projectId,
  ).map((r) => getPost(db, projectId, r.id));
}
export function savePost(
  db: DB,
  projectId: string,
  body: unknown,
  id?: string,
) {
  return db.transaction(() => {
    requireProject(db, projectId);
    const input = postInputSchema.parse(body);
    if (
      new Set(input.targets.map((t) => t.accountId)).size !==
      input.targets.length
    )
      throw new HttpError(400, "Select each account only once.");
    if (new Set(input.mediaIds).size !== input.mediaIds.length)
      throw new HttpError(400, "Select each media item only once.");
    for (const mediaId of input.mediaIds) getMedia(db, projectId, mediaId);
    for (const target of input.targets)
      if (
        !db
          .prepare(
            "SELECT 1 FROM project_accounts WHERE projectId=? AND accountId=?",
          )
          .get(projectId, target.accountId)
      )
        throw new HttpError(400, "Select an account assigned to this project.");
    if (id) {
      getPost(db, projectId, id);
      if (
        db
          .prepare(
            "SELECT id FROM jobs WHERE postId=? AND (status IN ('processing','published','needs_attention') OR checkpoint<>'{}')",
          )
          .get(id)
      )
        throw new HttpError(
          409,
          "This post has publishing activity. Duplicate it to create an editable draft.",
        );
    }
    const postId = id || randomUUID();
    const stamp = now();
    if (id) {
      db.prepare(
        "UPDATE posts SET title=?,caption=?,mediaIds=?,scheduledAt=NULL,updatedAt=? WHERE id=? AND projectId=?",
      ).run(
        input.title,
        input.caption,
        JSON.stringify(input.mediaIds),
        stamp,
        id,
        projectId,
      );
      db.prepare("DELETE FROM jobs WHERE postId=? AND projectId=?").run(
        id,
        projectId,
      );
    } else
      db.prepare("INSERT INTO posts VALUES (?,?,?,?,?,NULL,?,?)").run(
        postId,
        projectId,
        input.title,
        input.caption,
        JSON.stringify(input.mediaIds),
        stamp,
        stamp,
      );
    for (const target of input.targets)
      db.prepare(
        "INSERT INTO jobs (id,projectId,postId,accountId,input) VALUES (?,?,?,?,?)",
      ).run(
        randomUUID(),
        projectId,
        postId,
        target.accountId,
        JSON.stringify(target),
      );
    return getPost(db, projectId, postId);
  })();
}
export function schedulePost(
  db: DB,
  projectId: string,
  postId: string,
  body: unknown,
) {
  return db.transaction(() => {
    const input = scheduleSchema.parse(body);
    const post = getPost(db, projectId, postId);
    if (!["draft", "cancelled"].includes(post.state))
      throw new HttpError(
        409,
        "Only drafts or cancelled posts can be scheduled.",
      );
    if (!post.targets.length)
      throw new HttpError(400, "Select at least one account.");
    const stamp = input.immediate
      ? now()
      : new Date(input.scheduledAt || "").toISOString();
    if (!input.immediate && Date.parse(stamp) <= Date.now())
      throw new HttpError(400, "Choose a future time.");
    const accounts = listAccounts(db, projectId);
    const media = post.mediaIds.map((id) => getMedia(db, projectId, id));
    for (const target of post.targets) {
      const a = accounts.find((a) => a.id === target.accountId);
      if (!a || a.status !== "connected")
        throw new HttpError(
          400,
          "Every selected account must be assigned and connected.",
        );
      if (!a.capabilities.includes(target.format))
        throw new HttpError(
          400,
          `${a.name} does not support ${target.format}.`,
        );
      const errors = validateContent(a.platform, target, media, post.caption);
      if (errors.length)
        throw new HttpError(400, `${a.name}: ${errors.join(" ")}`);
    }
    db.prepare(
      "UPDATE posts SET scheduledAt=?,updatedAt=? WHERE id=? AND projectId=?",
    ).run(stamp, now(), postId, projectId);
    db.prepare(
      "UPDATE jobs SET status='scheduled',availableAt=?,error=NULL WHERE postId=? AND projectId=? AND status IN ('scheduled','cancelled')",
    ).run(stamp, postId, projectId);
    return getPost(db, projectId, postId);
  })();
}
export function cancelPost(db: DB, projectId: string, postId: string) {
  getPost(db, projectId, postId);
  db.prepare(
    "UPDATE jobs SET status='cancelled',error=NULL WHERE postId=? AND projectId=? AND status IN ('scheduled','paused','failed') AND json_extract(checkpoint,'$.stage') IS NULL AND remoteId IS NULL",
  ).run(postId, projectId);
  db.prepare(
    "UPDATE jobs SET status='cancelled',error=NULL WHERE postId=? AND projectId=? AND status='needs_attention' AND error='Missed while the worker was offline.'",
  ).run(postId, projectId);
  return getPost(db, projectId, postId);
}
export function retryJob(
  db: DB,
  projectId: string,
  postId: string,
  jobId: string,
) {
  return db.transaction(() => {
    const post = getPost(db, projectId, postId);
    const job = post.targets.find((t) => t.id === jobId);
    if (!job) throw new HttpError(404, "Destination not found.");
    if (!["failed", "paused", "needs_attention"].includes(job.status))
      throw new HttpError(409, "This destination cannot be retried.");
    const row = one(
      db,
      jobSchema,
      "SELECT * FROM jobs WHERE id=? AND projectId=?",
      jobId,
      projectId,
    );
    if (
      job.status === "needs_attention" &&
      row?.error !== "Missed while the worker was offline."
    )
      throw new HttpError(
        409,
        "Publishing outcome is uncertain. Check the platform before creating another post.",
      );
    const account = listAccounts(db, projectId).find(
      (a) => a.id === job.accountId,
    );
    if (!account || account.status !== "connected")
      throw new HttpError(
        409,
        "Assign and reconnect the account before retrying.",
      );
    db.prepare(
      "UPDATE jobs SET status='scheduled',availableAt=?,error=NULL,leaseUntil=NULL,leaseToken=NULL,checkpoint=json_set(checkpoint,'$.retryCount',0) WHERE id=? AND projectId=?",
    ).run(now(), jobId, projectId);
    return getPost(db, projectId, postId);
  })();
}

export function resolveJob(
  db: DB,
  projectId: string,
  postId: string,
  jobId: string,
  body: unknown,
) {
  return db.transaction(() => {
    const input = z
      .object({
        verified: z.literal(true),
        resolution: z.enum(["published", "not_published"]),
        remoteId: z.string().trim().max(200).default(""),
      })
      .parse(body);
    const post = getPost(db, projectId, postId);
    const target = post.targets.find((t) => t.id === jobId);
    if (!target || target.status !== "needs_attention")
      throw new HttpError(
        409,
        "Only a destination needing outcome review can be resolved.",
      );
    if (input.resolution === "published" && !input.remoteId)
      throw new HttpError(400, "Enter the platform post ID.");
    const stamp = now();
    if (input.resolution === "published")
      db.prepare(
        "UPDATE jobs SET status='published',remoteId=?,error=NULL,checkpoint=?,availableAt=NULL WHERE id=? AND projectId=?",
      ).run(
        input.remoteId,
        JSON.stringify({ stage: "done", remoteId: input.remoteId }),
        jobId,
        projectId,
      );
    else
      db.prepare(
        "UPDATE jobs SET status='failed',remoteId=NULL,url=NULL,checkpoint='{}',error='Manually confirmed not published. Explicit retry is available.',availableAt=NULL WHERE id=? AND projectId=?",
      ).run(jobId, projectId);
    db.prepare(
      "INSERT INTO attempts (id,jobId,startedAt,finishedAt,outcome) VALUES (?,?,?,?,?)",
    ).run(randomUUID(), jobId, stamp, stamp, `manual_${input.resolution}`);
    return getPost(db, projectId, postId);
  })();
}
