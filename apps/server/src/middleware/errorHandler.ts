import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import multer from "multer";
import { HttpError } from "../lib/security.js";
import { ProviderError } from "../services/providerHttp.js";
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof ZodError) {
    res.status(400).json({
      error: error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(" "),
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof ProviderError) {
    res.status(502).json({ error: error.message });
    return;
  }
  if (error instanceof multer.MulterError) {
    res.status(400).json({
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? "This file exceeds MAX_UPLOAD_BYTES."
          : "Upload one supported file at a time.",
    });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: "Invalid JSON request." });
    return;
  }
  console.error(
    "Request failed. Internal details withheld to protect connection credentials.",
  );
  res.status(500).json({
    error:
      "The request could not be completed. Check the server configuration.",
  });
};
