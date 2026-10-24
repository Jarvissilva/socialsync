import Database from "better-sqlite3";
import { z } from "zod";

export type DB = Database.Database;
export function openDatabase(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);`,
  );
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM migrations WHERE version=1").get()) return;
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalizedName TEXT NOT NULL UNIQUE, timeZone TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE connections (id TEXT PRIMARY KEY, platform TEXT NOT NULL, tokens TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'connected', createdAt TEXT NOT NULL);
      CREATE TABLE accounts (id TEXT PRIMARY KEY, connectionId TEXT NOT NULL REFERENCES connections(id), platform TEXT NOT NULL, externalId TEXT NOT NULL, name TEXT NOT NULL, username TEXT NOT NULL, capabilities TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(platform, externalId));
      CREATE TABLE project_accounts (projectId TEXT NOT NULL REFERENCES projects(id), accountId TEXT NOT NULL REFERENCES accounts(id), PRIMARY KEY(projectId,accountId));
      CREATE TABLE media (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE posts (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, caption TEXT NOT NULL, mediaIds TEXT NOT NULL, scheduledAt TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE jobs (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), postId TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, accountId TEXT NOT NULL REFERENCES accounts(id), input TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', availableAt TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, remoteId TEXT, url TEXT, checkpoint TEXT NOT NULL DEFAULT '{}', leaseUntil TEXT, leaseToken TEXT, UNIQUE(postId,accountId));
      CREATE INDEX jobs_due ON jobs(status,availableAt);
      CREATE INDEX jobs_project ON jobs(projectId,postId);
      CREATE INDEX media_project ON media(projectId);
      CREATE TABLE attempts (id TEXT PRIMARY KEY, jobId TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, startedAt TEXT NOT NULL, finishedAt TEXT, outcome TEXT, error TEXT);
      CREATE TABLE oauth_states (id TEXT PRIMARY KEY, platform TEXT NOT NULL, projectId TEXT, reconnectAccountId TEXT, verifier TEXT NOT NULL, expiresAt TEXT NOT NULL);
      CREATE TABLE discoveries (id TEXT PRIMARY KEY, platform TEXT NOT NULL, projectId TEXT, reconnectAccountId TEXT, payload TEXT NOT NULL, expiresAt TEXT NOT NULL);
      CREATE TABLE locks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expiresAt TEXT NOT NULL);
      CREATE TABLE runtime (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO migrations VALUES (1);
    `);
  }).immediate();
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM migrations WHERE version=2").get()) return;
    db.exec(`
      CREATE TABLE provider_apps (id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, clientId TEXT NOT NULL, secret TEXT NOT NULL, createdAt TEXT NOT NULL);
      ALTER TABLE connections ADD COLUMN providerAppId TEXT REFERENCES provider_apps(id);
      ALTER TABLE oauth_states ADD COLUMN providerAppId TEXT REFERENCES provider_apps(id);
      ALTER TABLE oauth_states ADD COLUMN processing INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE discoveries ADD COLUMN providerAppId TEXT REFERENCES provider_apps(id);
      CREATE INDEX connections_app ON connections(providerAppId);
      CREATE INDEX oauth_states_app ON oauth_states(providerAppId);
      CREATE INDEX discoveries_app ON discoveries(providerAppId);
      INSERT INTO migrations VALUES (2);
    `);
  }).immediate();
  return db;
}
export function one<T extends z.ZodType>(
  db: DB,
  schema: T,
  sql: string,
  ...params: (string | number | null)[]
): z.infer<T> | undefined {
  const row = db.prepare(sql).get(...params);
  return row ? schema.parse(row) : undefined;
}
export function many<T extends z.ZodType>(
  db: DB,
  schema: T,
  sql: string,
  ...params: (string | number | null)[]
): z.infer<T>[] {
  return z.array(schema).parse(db.prepare(sql).all(...params));
}
export const accountRowSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  platform: z.enum(["instagram", "facebook", "pinterest", "youtube"]),
  externalId: z.string(),
  name: z.string(),
  username: z.string(),
  capabilities: z.string(),
  createdAt: z.string(),
});
export const connectionSchema = z.object({
  providerAppId: z.string().nullable(),
  id: z.string(),
  platform: z.string(),
  tokens: z.string(),
  status: z.enum(["connected", "disconnected", "expired"]),
  createdAt: z.string(),
});
export const jobSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  postId: z.string(),
  accountId: z.string(),
  input: z.string(),
  status: z.enum([
    "scheduled",
    "processing",
    "published",
    "failed",
    "needs_attention",
    "cancelled",
    "paused",
  ]),
  availableAt: z.string().nullable(),
  attempts: z.number(),
  error: z.string().nullable(),
  remoteId: z.string().nullable(),
  url: z.string().nullable(),
  checkpoint: z.string(),
  leaseUntil: z.string().nullable(),
  leaseToken: z.string().nullable(),
});
export type Job = z.infer<typeof jobSchema>;
