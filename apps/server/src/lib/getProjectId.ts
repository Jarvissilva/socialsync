import type { Request } from "express";
import { idSchema } from "@social/shared";
export const projectId = (request: Request) =>
  idSchema.parse(request.params.projectId);
