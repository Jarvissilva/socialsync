import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config.js";
import { accountRowSchema, one, type DB } from "../database.js";
import { HttpError } from "../lib/security.js";
import { listAccounts } from "./workspaceService.js";
import { usableTokens } from "./accountService.js";
import { request } from "./providerHttp.js";
import { acquireLock, releaseLock } from "../lib/locks.js";

export async function listPinterestBoards(
  db: DB,
  config: Config,
  projectId: string,
  accountId: string,
) {
  if (!listAccounts(db, projectId).some((a) => a.id === accountId))
    throw new HttpError(404, "Account not assigned to this project.");
  const account = one(
    db,
    accountRowSchema,
    "SELECT * FROM accounts WHERE id=?",
    accountId,
  );
  if (!account || account.platform !== "pinterest")
    throw new HttpError(400, "Select a Pinterest account.");
  const owner = randomUUID();
  if (!acquireLock(db, `connection:${account.connectionId}`, owner, 150_000))
    throw new HttpError(
      409,
      "This account is busy publishing. Try loading boards again shortly.",
    );
  const heartbeat = setInterval(
    () => acquireLock(db, `connection:${account.connectionId}`, owner, 150_000),
    5000,
  );
  try {
    const tokens = await usableTokens(db, config, account.connectionId);
    return z
      .object({
        items: z.array(z.object({ id: z.string(), name: z.string() })),
      })
      .parse(
        await request("https://api.pinterest.com/v5/boards?page_size=250", {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        }),
      ).items;
  } finally {
    clearInterval(heartbeat);
    releaseLock(db, `connection:${account.connectionId}`, owner);
  }
}
