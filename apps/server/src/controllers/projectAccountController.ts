import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { idSchema } from "@social/shared";
import { one, accountRowSchema } from "../database.js";
import { HttpError } from "../lib/security.js";
import * as workspace from "../services/workspaceService.js";
import * as accounts from "../services/accountService.js";
import { request } from "../services/providerHttp.js";
import { acquireLock, releaseLock } from "../services/schedulingWorker.js";
import { projectId as pid } from "../lib/getProjectId.js";
export function projectAccountController(db: DB, config: Config) {
  const list: RequestHandler = (req, res) =>
    res.json(workspace.listAccounts(db, pid(req)));
  const assign: RequestHandler = (req, res) => {
    const body = z.object({ accountId: idSchema }).parse(req.body);
    workspace.assignAccount(db, pid(req), body.accountId);
    res.status(201).json({ ok: true });
  };
  const remove: RequestHandler = (req, res) => {
    workspace.removeAssignment(
      db,
      pid(req),
      idSchema.parse(req.params.accountId),
    );
    res.json({ ok: true });
  };
  const boards: RequestHandler = async (req, res) => {
    const projectId = pid(req),
      accountId = idSchema.parse(req.params.accountId);
    if (!workspace.listAccounts(db, projectId).some((a) => a.id === accountId))
      throw new HttpError(404, "Account not assigned to this project.");
    const a = one(
      db,
      accountRowSchema,
      "SELECT * FROM accounts WHERE id=?",
      accountId,
    );
    if (!a || a.platform !== "pinterest")
      throw new HttpError(400, "Select a Pinterest account.");
    const owner = randomUUID();
    if (!acquireLock(db, `connection:${a.connectionId}`, owner, 150_000))
      throw new HttpError(
        409,
        "This account is busy publishing. Try loading boards again shortly.",
      );
    const heartbeat = setInterval(
      () => acquireLock(db, `connection:${a.connectionId}`, owner, 150_000),
      5000,
    );
    try {
      const tokens = await accounts.usableTokens(db, config, a.connectionId);
      const result = z
        .object({
          items: z.array(z.object({ id: z.string(), name: z.string() })),
        })
        .parse(
          await request("https://api.pinterest.com/v5/boards?page_size=250", {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          }),
        );
      res.json(result.items);
    } finally {
      clearInterval(heartbeat);
      releaseLock(db, `connection:${a.connectionId}`, owner);
    }
  };
  return { list, assign, remove, boards };
}
