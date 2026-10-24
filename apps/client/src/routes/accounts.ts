import { z } from "zod";
import {
  redirectDocument,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import {
  accountSchema,
  projectSchema,
  providerStatusSchema,
  discoverySchema,
  providerSchema,
  connectInputSchema,
} from "@socialsync/shared";
import { api, json, okSchema } from "@/lib/api";
import { actionResult, fieldId, projectPath } from "./shared";
export async function accountsLoader({ params, request }: LoaderFunctionArgs) {
  return {
    accounts: await api(
      params.projectId
        ? `${projectPath(params.projectId)}/accounts`
        : "/accounts",
      z.array(accountSchema),
      { signal: request.signal },
    ),
  };
}
export const impactSchema = z.object({
  accounts: z.array(accountSchema),
  projects: z.array(projectSchema),
  pendingCount: z.number(),
});
export const boardsSchema = z.array(
  z.object({ id: z.string(), name: z.string() }),
);
export async function providersLoader({ request }: LoaderFunctionArgs) {
  return actionResult(() =>
    api("/providers", z.array(providerStatusSchema), {
      signal: request.signal,
    }),
  );
}
export async function discoveryLoader({ params, request }: LoaderFunctionArgs) {
  return actionResult(() =>
    api(
      `/accounts/discoveries/${fieldId.parse(params.discoveryId)}`,
      discoverySchema,
      { signal: request.signal },
    ),
  );
}
export async function impactLoader({ params, request }: LoaderFunctionArgs) {
  return actionResult(() =>
    api(`/accounts/${fieldId.parse(params.accountId)}/impact`, impactSchema, {
      signal: request.signal,
    }),
  );
}
export async function boardsLoader({ params, request }: LoaderFunctionArgs) {
  return actionResult(() =>
    api(
      `${projectPath(params.projectId)}/accounts/${fieldId.parse(params.accountId)}/boards`,
      boardsSchema,
      { signal: request.signal },
    ),
  );
}
export async function accountsAction({ params, request }: ActionFunctionArgs) {
  const result = await actionResult(async () => {
    const form = await request.formData();
    const intent = z
      .enum([
        "connect",
        "assign",
        "remove-account",
        "disconnect",
        "save-discovery",
      ])
      .parse(form.get("intent"));
    const send = <T extends z.ZodType>(
      path: string,
      schema: T,
      body: unknown,
    ) => api(path, schema, { ...json("POST", body), signal: request.signal });
    if (intent === "connect") {
      const platform = providerSchema.parse(form.get("platform"));
      const input = connectInputSchema.parse({
        providerAppId: form.get("providerAppId") || undefined,
        projectId: params.projectId,
        reconnectAccountId: form.get("reconnectAccountId") || undefined,
      });
      const { url } = await send(
        `/accounts/connect/${platform}`,
        z.object({ url: z.url() }),
        input,
      );
      return redirectDocument(url);
    }
    if (intent === "save-discovery")
      return send(
        `/accounts/discoveries/${fieldId.parse(form.get("discoveryId"))}`,
        z.object({
          accountIds: z.array(z.string()),
          projectId: z.string().nullable(),
        }),
        {
          externalIds: z
            .array(z.string())
            .min(1)
            .parse(form.getAll("externalIds")),
        },
      );
    const accountId = fieldId.parse(form.get("accountId"));
    if (intent === "disconnect") {
      z.literal("true").parse(form.get("confirmed"));
      return send(`/accounts/${accountId}/disconnect`, okSchema, {
        confirmed: true,
      });
    }
    // Project pages always use their URL scope. Only the global library chooses a project.
    const base = projectPath(
      params.projectId || z.string().parse(form.get("projectId")),
    );
    if (intent === "assign")
      return send(`${base}/accounts`, okSchema, { accountId });
    return api(`${base}/accounts/${accountId}`, okSchema, {
      method: "DELETE",
      signal: request.signal,
    });
  });
  if (result.ok && result.value instanceof Response) return result.value;
  return result;
}
