import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { z } from "zod";
import { idSchema, providerSchema } from "@socialsync/shared";
import { one, accountRowSchema, many } from "../database.js";
import { HttpError, signature } from "../lib/security.js";
import * as workspace from "../services/workspaceService.js";
import * as accounts from "../services/accountService.js";
export function accountController(db: DB, config: Config) {
  const list: RequestHandler = (_req, res) =>
    res.json(workspace.listAccounts(db));
  const connect: RequestHandler = (req, res) => {
    const platform = providerSchema.parse(req.params.platform);
    const result = accounts.beginConnection(db, config, platform, req.body);
    res.cookie(
      `oauth_${result.state}`,
      signature(`oauth:${result.state}`, config.encryptionKey),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: config.callbackOrigin.startsWith("https:"),
        maxAge: 600_000,
        path: "/public/oauth",
      },
    );
    res.json({ url: result.url });
  };
  const discovery: RequestHandler = (req, res) =>
    res.json(
      accounts.getDiscovery(db, config, idSchema.parse(req.params.id)).public,
    );
  const saveDiscovery: RequestHandler = (req, res) =>
    res.json(
      accounts.saveDiscovery(
        db,
        config,
        idSchema.parse(req.params.id),
        req.body,
      ),
    );
  const impact: RequestHandler = (req, res) => {
    const a = one(
      db,
      accountRowSchema,
      "SELECT * FROM accounts WHERE id=?",
      idSchema.parse(req.params.accountId),
    );
    if (!a) throw new HttpError(404, "Account not found.");
    const related = many(
      db,
      accountRowSchema,
      "SELECT * FROM accounts WHERE connectionId=?",
      a.connectionId,
    );
    const all = workspace
      .listAccounts(db)
      .filter((item) => related.some((a) => a.id === item.id));
    const projectIds = new Set(all.flatMap((a) => a.projectIds));
    res.json({
      accounts: all,
      projects: workspace.listProjects(db).filter((p) => projectIds.has(p.id)),
      pendingCount:
        one(
          db,
          z.object({ n: z.number() }),
          "SELECT count(*) n FROM jobs WHERE accountId IN (SELECT id FROM accounts WHERE connectionId=?) AND (status IN ('processing','paused','needs_attention') OR (status='scheduled' AND availableAt IS NOT NULL))",
          a.connectionId,
        )?.n || 0,
    });
  };
  const disconnect: RequestHandler = (req, res) => {
    z.object({ confirmed: z.literal(true) }).parse(req.body);
    workspace.disconnectAccount(db, idSchema.parse(req.params.accountId));
    res.json({ ok: true });
  };
  return { list, connect, discovery, saveDiscovery, impact, disconnect };
}
