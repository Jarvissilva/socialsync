import { z } from "zod";
import { type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import {
  projectSchema,
  projectInputSchema,
  accountSchema,
  healthSchema,
} from "@social/shared";
import { api, json } from "@/lib/api";
import { actionResult, projectPath } from "./shared";
export async function rootLoader({ request }: LoaderFunctionArgs) {
  const [projects, accounts] = await Promise.all([
    api("/projects", z.array(projectSchema), { signal: request.signal }),
    api("/accounts", z.array(accountSchema), { signal: request.signal }),
  ]);
  return { projects, accounts };
}
export async function projectLoader({ params, request }: LoaderFunctionArgs) {
  const [projects, health] = await Promise.all([
    api("/projects", z.array(projectSchema), { signal: request.signal }),
    api("/health", healthSchema, { signal: request.signal }),
  ]);
  const project = projects.find((p) => p.id === params.projectId);
  if (!project) throw new Response("Project not found", { status: 404 });
  return { project, health };
}
export async function settingsLoader({ request }: LoaderFunctionArgs) {
  return {
    health: await api("/health", healthSchema, { signal: request.signal }),
  };
}
export async function workspaceAction({ request, params }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "create-project") {
    return actionResult(() =>
      api("/projects", projectSchema, {
        ...json("POST", projectInputSchema.parse(Object.fromEntries(form))),
        signal: request.signal,
      }),
    );
  }
  return actionResult(async () => {
    z.literal("save-settings").parse(intent);
    return api(projectPath(params.projectId), projectSchema, {
      ...json("PUT", projectInputSchema.parse(Object.fromEntries(form))),
      signal: request.signal,
    });
  });
}
