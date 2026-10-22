import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import { HttpError } from "../lib/security.js";
export function requireLocal(config: Config): RequestHandler {
  return (req, _res, next) => {
    const host = req.get("host") || "";
    const allowed = new Set([
      `127.0.0.1:${config.port}`,
      `localhost:${config.port}`,
      new URL(config.appOrigin).host,
    ]);
    if (!allowed.has(host))
      throw new HttpError(
        403,
        "This endpoint is available only through the local app.",
      );
    if (req.get("sec-fetch-site") === "cross-site")
      throw new HttpError(403, "Cross-site requests are not allowed.");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if (
        origin &&
        origin !== config.appOrigin &&
        origin !== `http://127.0.0.1:${config.port}` &&
        origin !== `http://localhost:${config.port}`
      )
        throw new HttpError(403, "Request origin is not allowed.");
      if (req.get("x-socialdesk-client") !== "1")
        throw new HttpError(403, "Missing local application request header.");
    }
    next();
  };
}
