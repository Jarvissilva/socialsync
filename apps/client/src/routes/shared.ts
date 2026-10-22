import { z } from "zod";
import { idSchema } from "@social/shared";
import { ApiError } from "@/lib/api";

export type ActionResult<T> =
  { ok: true; value: T } | { ok: false; error: string; savedPostId?: string };
export function expectedError(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues.map((issue) => issue.message).join(" ");
  if (error instanceof ApiError) return error.message;
  throw error;
}
export async function actionResult<T>(
  run: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: expectedError(error) };
  }
}
export const fieldId = idSchema;
export function projectPath(projectId: string | undefined) {
  return `/projects/${fieldId.parse(projectId)}`;
}

export const postJsonSchema = z.string().transform((value, ctx): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid post data." });
    return z.NEVER;
  }
});
