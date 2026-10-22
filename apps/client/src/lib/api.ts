import { z } from "zod";
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T extends z.ZodType>(
  path: string,
  schema: T,
  init: RequestInit = {},
): Promise<z.infer<T>> {
  const headers = new Headers(init.headers);
  headers.set("X-SocialDesk-Client", "1");
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new ApiError(
      error.success ? error.data.error : `Request failed (${response.status}).`,
      response.status,
    );
  }
  const result = schema.safeParse(await response.json());
  if (!result.success)
    throw new Error("The server returned an invalid response.", {
      cause: result.error,
    });
  return result.data;
}
export const okSchema = z.object({ ok: z.boolean() });
export const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});
