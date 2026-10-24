import type { DB } from "../database.js";

const now = () => new Date().toISOString();

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
