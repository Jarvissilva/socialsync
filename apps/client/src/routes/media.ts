import { z } from "zod";
import { type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { mediaSchema } from "@socialsync/shared";
import { api, okSchema } from "@/lib/api";
import { actionResult, fieldId, projectPath } from "./shared";
export async function mediaLoader({ params, request }: LoaderFunctionArgs) {
  return {
    media: await api(
      `${projectPath(params.projectId)}/media`,
      z.array(mediaSchema),
      { signal: request.signal },
    ),
  };
}
export async function mediaAction({ params, request }: ActionFunctionArgs) {
  return actionResult(async () => {
    const form = await request.formData();
    const intent = z
      .enum(["upload-media", "delete-media"])
      .parse(form.get("intent"));
    const path = `${projectPath(params.projectId)}/media`;
    if (intent === "delete-media")
      return api(`${path}/${fieldId.parse(form.get("mediaId"))}`, okSchema, {
        method: "DELETE",
        signal: request.signal,
      });
    const file = form.get("file");
    if (!(file instanceof File) || !file.size)
      throw new z.ZodError([
        { code: "custom", path: ["file"], message: "Choose a file to upload." },
      ]);
    const body = new FormData();
    body.set("file", file);
    return api(path, mediaSchema, {
      method: "POST",
      body,
      signal: request.signal,
    });
  });
}
