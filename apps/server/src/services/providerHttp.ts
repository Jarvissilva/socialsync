import { z } from "zod";
type MetaRequestStage =
  | "Meta code exchange"
  | "Meta long-lived token exchange"
  | "Meta account discovery";
const metaErrorSchema = z.object({
  error: z.object({
    code: z.number().int().nonnegative().optional(),
    error_subcode: z.number().int().nonnegative().optional(),
  }),
});
export class ProviderError extends Error {
  constructor(
    message: string,
    public retryable = false,
    public uncertain = false,
    public auth = false,
  ) {
    super(message);
  }
}
export async function request(
  url: string | URL,
  init: RequestInit = {},
  mutating = false,
  stage?: MetaRequestStage,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init.signal || AbortSignal.timeout(120_000),
    });
  } catch {
    throw new ProviderError(
      stage
        ? `${stage} failed: the platform connection was interrupted.`
        : "The platform connection was interrupted.",
      !mutating,
      mutating,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok) {
    // Only numeric codes are safe to expose. Provider messages, URLs, and bodies
    // can echo OAuth codes, tokens, or client secrets.
    const meta = stage ? metaErrorSchema.safeParse(body) : undefined;
    const details = [`HTTP ${response.status}`];
    if (meta?.success) {
      if (meta.data.error.code !== undefined)
        details.push(`Meta code ${meta.data.error.code}`);
      if (meta.data.error.error_subcode !== undefined)
        details.push(`Meta subcode ${meta.data.error.error_subcode}`);
    }
    throw new ProviderError(
      `${stage ? `${stage} failed` : "Platform request failed"} (${details.join("; ")}). Check permissions, account eligibility, and media requirements.`,
      response.status === 429 || (!mutating && response.status >= 500),
      mutating && response.status >= 500,
      [401, 403].includes(response.status),
    );
  }
  return body;
}
export const accessTokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});
export const remoteIdSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
});
