import { z } from "zod";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  providerAppSchema,
  providerAppInputSchema,
  providerAppUpdateSchema,
} from "@socialsync/shared";
import { api, json, okSchema } from "@/lib/api";
import { actionResult, fieldId } from "./shared";

export async function providerAppsLoader({ request }: LoaderFunctionArgs) {
  return {
    apps: await api("/provider-apps", z.array(providerAppSchema), {
      signal: request.signal,
    }),
  };
}
export async function providerAppsResourceLoader({
  request,
}: LoaderFunctionArgs) {
  return actionResult(() =>
    api("/provider-apps", z.array(providerAppSchema), {
      signal: request.signal,
    }),
  );
}
export async function providerAppsAction({ request }: ActionFunctionArgs) {
  return actionResult(async () => {
    const form = await request.formData();
    const intent = z
      .enum(["create", "update", "delete"])
      .parse(form.get("intent"));
    if (intent === "create") {
      const input = providerAppInputSchema.parse(
        Object.fromEntries(
          ["name", "provider", "clientId", "clientSecret"].map((key) => [
            key,
            form.get(key),
          ]),
        ),
      );
      return api("/provider-apps", providerAppSchema, {
        ...json("POST", input),
        signal: request.signal,
      });
    }
    const id = fieldId.parse(form.get("id"));
    if (intent === "delete")
      return api(`/provider-apps/${id}`, okSchema, {
        method: "DELETE",
        signal: request.signal,
      });
    const input = providerAppUpdateSchema.parse({
      name: form.get("name") || undefined,
      clientSecret: form.get("clientSecret") || undefined,
    });
    return api(`/provider-apps/${id}`, providerAppSchema, {
      ...json("PUT", input),
      signal: request.signal,
    });
  });
}
