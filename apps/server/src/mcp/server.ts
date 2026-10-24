import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { idSchema, postInputSchema, projectInputSchema } from "@socialsync/shared";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { HttpError } from "../lib/security.js";
import * as workspace from "../services/workspaceService.js";
import { importMedia } from "../services/mediaService.js";
import { listPinterestBoards } from "../services/pinterestService.js";
import { ProviderError } from "../services/providerHttp.js";
import { workspaceStatus } from "../services/statusService.js";

const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const create = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const edit = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
const publish = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};
const project = {
  projectId: idSchema.describe("Project that owns the resource."),
};
const post = { ...project, postId: idSchema };
const job = {
  ...post,
  jobId: idSchema.describe(
    "Destination/job ID from get_post, not an account ID.",
  ),
};

async function result(
  action: () => unknown | Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const value = await action();
    const data = { data: value ?? null };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  } catch (error) {
    // Never return SQLite, filesystem, SDK errors, stacks, tokens, or configuration.
    const message =
      error instanceof HttpError || error instanceof ProviderError
        ? error.message
        : error instanceof z.ZodError
          ? error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join(" ")
          : "The operation failed. Check SocialSync configuration and the selected local media file, then try again.";
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

export function createMcpServer(db: DB, config: Config) {
  const server = new McpServer(
    { name: "socialsync", version: "0.1.0" },
    {
      instructions:
        "Manage the local SocialSync workspace. Choose a project before accessing its accounts, media, or posts. Save drafts for review; schedule, publish immediately, or retry only when the user requests it. Scheduling queues the existing durable worker; check get_status for worker readiness. An uncertain destination requires verified platform outcome review before retry. Account connections and developer credentials are managed in the local dashboard. Never infer IDs or reuse another project's media or account assignments.",
    },
  );
  server.registerTool(
    "get_status",
    {
      description:
        "Check the publishing worker heartbeat and media delivery configuration. No credentials are returned.",
      inputSchema: {},
      annotations: read,
    },
    () => result(() => workspaceStatus(db, config)),
  );
  server.registerTool(
    "list_projects",
    {
      description: "List projects and their account and scheduled-post counts.",
      inputSchema: {},
      annotations: read,
    },
    () => result(() => workspace.listProjects(db)),
  );
  server.registerTool(
    "create_project",
    {
      description: "Create a project with a unique name and IANA time zone.",
      inputSchema: { input: projectInputSchema },
      annotations: create,
    },
    ({ input }) => result(() => workspace.saveProject(db, input)),
  );
  server.registerTool(
    "update_project",
    {
      description:
        "Rename a project or set its time zone. Supply the complete project settings.",
      inputSchema: { ...project, input: projectInputSchema },
      annotations: edit,
    },
    ({ projectId, input }) =>
      result(() => workspace.saveProject(db, input, projectId)),
  );
  server.registerTool(
    "list_accounts",
    {
      description:
        "List safe account metadata. With projectId, return only accounts assigned to that project; omit it to inspect the global library before assigning accounts.",
      inputSchema: { projectId: idSchema.optional() },
      annotations: read,
    },
    ({ projectId }) => result(() => workspace.listAccounts(db, projectId)),
  );
  server.registerTool(
    "assign_account",
    {
      description:
        "Assign an existing global account to a project. Does not create or change credentials.",
      inputSchema: { ...project, accountId: idSchema },
      annotations: { ...create, idempotentHint: true },
    },
    ({ projectId, accountId }) =>
      result(() => {
        workspace.assignAccount(db, projectId, accountId);
        return { ok: true };
      }),
  );
  server.registerTool(
    "remove_account_assignment",
    {
      description:
        "Remove an account assignment from this project. Pending or uncertain publications prevent removal.",
      inputSchema: { ...project, accountId: idSchema },
      annotations: edit,
    },
    ({ projectId, accountId }) =>
      result(() => {
        workspace.removeAssignment(db, projectId, accountId);
        return { ok: true };
      }),
  );
  server.registerTool(
    "list_pinterest_boards",
    {
      description:
        "Fetch board IDs and names for an assigned Pinterest account, coordinating authorization with the publishing worker.",
      inputSchema: { ...project, accountId: idSchema },
      annotations: { ...read, openWorldHint: true },
    },
    ({ projectId, accountId }) =>
      result(() => listPinterestBoards(db, config, projectId, accountId)),
  );
  server.registerTool(
    "list_media",
    {
      description:
        "List original media metadata owned by the project. Does not return signed public links or credentials.",
      inputSchema: project,
      annotations: read,
    },
    ({ projectId }) => result(() => workspace.listMedia(db, projectId)),
  );
  server.registerTool(
    "upload_media",
    {
      description:
        "Copy a user-selected local file into the project's media library. Pass an absolute local path to JPEG, PNG, WebP, GIF, MP4/MOV, or WebM. The original file is preserved. Instagram automatically converts supported still images when publishing.",
      inputSchema: { ...project, path: z.string().min(1).max(4096) },
      annotations: create,
    },
    ({ projectId, path }) =>
      result(() => importMedia(db, config, projectId, path)),
  );
  server.registerTool(
    "delete_media",
    {
      description:
        "Delete an unused original and its derived files from this project's media library. Media referenced by a post cannot be deleted.",
      inputSchema: { ...project, mediaId: idSchema },
      annotations: edit,
    },
    ({ projectId, mediaId }) =>
      result(() => {
        workspace.deleteMedia(db, projectId, mediaId, config.mediaDir);
        return { ok: true };
      }),
  );
  server.registerTool(
    "list_posts",
    {
      description:
        "List this project's drafts, schedules, publication results, and destination statuses.",
      inputSchema: project,
      annotations: read,
    },
    ({ projectId }) => result(() => workspace.listPosts(db, projectId)),
  );
  server.registerTool(
    "get_post",
    {
      description:
        "Read a project's post with destination/job IDs, status, errors, remote post IDs, and publication URLs.",
      inputSchema: post,
      annotations: read,
    },
    ({ projectId, postId }) =>
      result(() => workspace.getPost(db, projectId, postId)),
  );
  server.registerTool(
    "create_post",
    {
      description:
        "Save a draft without publishing. Media IDs and target account assignments must belong to this project. Media order determines carousel order.",
      inputSchema: { ...project, input: postInputSchema },
      annotations: create,
    },
    ({ projectId, input }) =>
      result(() => workspace.savePost(db, projectId, input)),
  );
  server.registerTool(
    "update_post",
    {
      description:
        "Replace the complete editable draft input. Read get_post first and preserve all desired captions, media IDs, and targets; omitted fields reset to defaults. Editable scheduled posts return to draft. Processing or published posts cannot be edited.",
      inputSchema: { ...post, input: postInputSchema },
      annotations: { ...edit, idempotentHint: false },
    },
    ({ projectId, postId, input }) =>
      result(() => workspace.savePost(db, projectId, input, postId)),
  );
  server.registerTool(
    "schedule_post",
    {
      description:
        "Queue a draft/cancelled post for publication at a future ISO 8601 timestamp with UTC offset. This authorizes real publication by the durable worker. Use only when the user requests scheduling; check get_status first.",
      inputSchema: { ...post, scheduledAt: z.iso.datetime({ offset: true }) },
      annotations: publish,
    },
    ({ projectId, postId, scheduledAt }) =>
      result(() =>
        workspace.schedulePost(db, projectId, postId, { scheduledAt }),
      ),
  );
  server.registerTool(
    "publish_post",
    {
      description:
        "Queue a draft/cancelled post for immediate real publication by the durable worker. Use only when the user requests publishing now. This returns queued state, not confirmation of publication; check get_post for final results.",
      inputSchema: post,
      annotations: publish,
    },
    ({ projectId, postId }) =>
      result(() =>
        workspace.schedulePost(db, projectId, postId, { immediate: true }),
      ),
  );
  server.registerTool(
    "cancel_post",
    {
      description:
        "Cancel the remaining safe queued destinations. Existing remote IDs, in-flight publications, and uncertain outcomes are preserved.",
      inputSchema: post,
      annotations: edit,
    },
    ({ projectId, postId }) =>
      result(() => workspace.cancelPost(db, projectId, postId)),
  );
  server.registerTool(
    "retry_destination",
    {
      description:
        "Explicitly resume an eligible failed, paused, or missed destination. May publish real content. Never retries a successful or uncertain destination automatically.",
      inputSchema: job,
      annotations: publish,
    },
    ({ projectId, postId, jobId }) =>
      result(() => workspace.retryJob(db, projectId, postId, jobId)),
  );
  server.registerTool(
    "resolve_destination",
    {
      description:
        "Record a verified platform outcome for a needs_attention destination. Use only after the user has checked the real platform. published requires the remote post ID; not_published makes explicit retry available without scheduling it.",
      inputSchema: {
        ...job,
        verified: z.literal(true),
        resolution: z.enum(["published", "not_published"]),
        remoteId: z.string().trim().max(200).optional(),
      },
      annotations: { ...edit, idempotentHint: false },
    },
    ({ projectId, postId, jobId, ...input }) =>
      result(() => workspace.resolveJob(db, projectId, postId, jobId, input)),
  );
  return server;
}
