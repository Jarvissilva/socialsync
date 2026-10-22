import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { join } from "node:path";
import { z } from "zod";
import { idSchema, providerSchema } from "@social/shared";
import { HttpError, verifySignature } from "../lib/security.js";
import * as workspace from "../services/workspaceService.js";
import * as accounts from "../services/accountService.js";
import { ProviderError } from "../services/providerHttp.js";
export function publicController(db: DB, config: Config) {
  const deliverMedia: RequestHandler = (req, res) => {
    const projectId = idSchema.parse(req.params.projectId),
      id = idSchema.parse(req.params.mediaId);
    const expires = z
      .string()
      .regex(/^\d{13}$/)
      .parse(req.query.expires);
    const signed = z.string().parse(req.query.signature);
    if (
      Number(expires) < Date.now() ||
      Number(expires) > Date.now() + 25 * 60 * 60 * 1000 ||
      !verifySignature(
        `${projectId}:${id}:${expires}`,
        signed,
        config.encryptionKey,
      )
    )
      throw new HttpError(403, "This media link has expired or is invalid.");
    const media = workspace.getMedia(db, projectId, id);
    res.setHeader("Cache-Control", "private, no-store");
    res.type(media.mime);
    res.sendFile(join(config.mediaDir, id));
  };
  const oauthCallback: RequestHandler = async (req, res) => {
    const platform = providerSchema.parse(req.params.platform);
    const state = idSchema.parse(req.query.state);
    const cookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`oauth_${state}=`))
      ?.split("=")[1];
    if (
      !cookie ||
      !verifySignature(`oauth:${state}`, cookie, config.encryptionKey)
    )
      throw new HttpError(
        403,
        "OAuth browser state did not match. Start the connection again.",
      );
    res.clearCookie(`oauth_${state}`, {
      path: "/public/oauth",
      httpOnly: true,
      sameSite: "lax",
      secure: config.callbackOrigin.startsWith("https:"),
    });
    if (req.query.error) {
      db.prepare("DELETE FROM oauth_states WHERE id=?").run(state);
      res.redirect(
        `${config.appOrigin}/accounts?connectionError=Authorization%20was%20cancelled`,
      );
      return;
    }
    try {
      const id = await accounts.completeConnection(
        db,
        config,
        platform,
        state,
        z.string().min(1).parse(req.query.code),
      );
      res.redirect(`${config.appOrigin}/accounts?discovery=${id}`);
    } catch (error) {
      const message =
        error instanceof HttpError || error instanceof ProviderError
          ? error.message
          : "Could not connect this account. Check developer app permissions and callback configuration.";
      res.redirect(
        `${config.appOrigin}/accounts?connectionError=${encodeURIComponent(message)}`,
      );
    }
  };
  return { deliverMedia, oauthCallback };
}
