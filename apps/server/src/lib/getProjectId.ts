import type { Request } from "express";
import { idSchema } from "@socialsync/shared";
export const projectId = (request: Request) =>
  idSchema.parse(request.params.projectId);
