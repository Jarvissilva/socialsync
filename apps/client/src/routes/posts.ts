import { z } from "zod";
import {
  redirect,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import {
  postSchema,
  postInputSchema,
  accountSchema,
  mediaSchema,
  scheduleSchema,
  timeZoneSchema,
} from "@social/shared";
import { api, json } from "@/lib/api";
import { zonedInputToIso } from "@/lib/dates";
import {
  actionResult,
  expectedError,
  postJsonSchema,
  fieldId,
  projectPath,
  type ActionResult,
} from "./shared";
export async function postsLoader({ params, request }: LoaderFunctionArgs) {
  return {
    posts: await api(
      `${projectPath(params.projectId)}/posts`,
      z.array(postSchema),
      { signal: request.signal },
    ),
  };
}
export async function composeLoader({ params, request }: LoaderFunctionArgs) {
  const base = projectPath(params.projectId),
    init = { signal: request.signal };
  const [accounts, media, post] = await Promise.all([
    api(`${base}/accounts`, z.array(accountSchema), init),
    api(`${base}/media`, z.array(mediaSchema), init),
    params.postId
      ? api(`${base}/posts/${fieldId.parse(params.postId)}`, postSchema, init)
      : undefined,
  ]);
  return { accounts, media, post };
}
export async function composeAction(
  args: ActionFunctionArgs,
): Promise<ActionResult<{ postId: string; baseline: string }> | Response> {
  const form = await args.request.formData();
  let savedPostId: string | undefined;
  try {
    const intent = z
      .enum(["draft", "schedule", "publish"])
      .parse(form.get("intent"));
    const input = postJsonSchema.pipe(postInputSchema).parse(form.get("input"));
    const payload = {
      ...input,
      targets: input.targets.map((t) => ({
        ...t,
        title: t.title || input.title,
      })),
    };
    const id = fieldId.optional().parse(form.get("postId") || undefined);
    const base = `${projectPath(args.params.projectId)}/posts`;
    const scheduledAt =
      intent === "schedule"
        ? z
            .string()
            .transform((value, ctx) => {
              try {
                return zonedInputToIso(
                  value,
                  timeZoneSchema.parse(form.get("timeZone")),
                );
              } catch (error) {
                ctx.addIssue({
                  code: "custom",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Choose a publishing time.",
                });
                return z.NEVER;
              }
            })
            .parse(form.get("time"))
        : undefined;
    const result = await api(`${base}${id ? `/${id}` : ""}`, postSchema, {
      ...json(id ? "PUT" : "POST", payload),
      signal: args.request.signal,
    });
    savedPostId = result.id;
    if (intent !== "draft") {
      await api(`${base}/${result.id}/schedule`, postSchema, {
        ...json(
          "POST",
          scheduleSchema.parse({
            immediate: intent === "publish",
            scheduledAt,
          }),
        ),
        signal: args.request.signal,
      });
      return redirect(`${projectPath(args.params.projectId)}/posts`);
    }
    return {
      ok: true,
      value: { postId: result.id, baseline: JSON.stringify(input) },
    };
  } catch (error) {
    // Keep the known draft ID even when the scheduling response is lost.
    return {
      ok: false,
      error:
        savedPostId && error instanceof Error
          ? error.message
          : expectedError(error),
      savedPostId,
    };
  }
}
export async function postsAction({ params, request }: ActionFunctionArgs) {
  return actionResult(async () => {
    const form = await request.formData();
    const intent = z
      .enum(["cancel", "duplicate", "retry", "published", "not_published"])
      .parse(form.get("intent"));
    const base = `${projectPath(params.projectId)}/posts`,
      id = fieldId.parse(form.get("postId"));
    const send = (path: string, body: unknown) =>
      api(path, postSchema, { ...json("POST", body), signal: request.signal });
    if (intent === "duplicate") {
      const post = await api(`${base}/${id}`, postSchema, {
        signal: request.signal,
      });
      return send(base, postInputSchema.parse(post));
    }
    if (intent === "cancel") return send(`${base}/${id}/cancel`, {});
    const job = fieldId.parse(form.get("jobId"));
    if (intent === "retry")
      return send(`${base}/${id}/destinations/${job}/retry`, {});
    const resolution = z
      .object({
        resolution: z.enum(["published", "not_published"]),
        verified: z.literal(true),
        remoteId: z.string(),
      })
      .parse({
        resolution: intent,
        verified: form.get("verified") === "true",
        remoteId: form.get("remoteId") || "",
      });
    return send(`${base}/${id}/destinations/${job}/resolve`, resolution);
  });
}
