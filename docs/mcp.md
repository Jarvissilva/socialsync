# SocialSync MCP

SocialSync exposes an MCP endpoint at `/mcp` using Streamable HTTP. It starts automatically with the existing app server and shares its port, SQLite database, project ownership checks, media validation, encrypted authorizations, publishing locks, and durable queue. It does not create another listener or publishing worker.

## Run and connect

Configure `apps/server/.env` as described in the main README and start SocialSync normally:

```sh
pnpm dev
```

For a production build, use `pnpm build` followed by `pnpm start`. Connect your local MCP client with:

```json
{
  "mcpServers": {
    "socialsync": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3002/mcp",
      "headers": {
        "X-SocialSync-Client": "1"
      }
    }
  }
}
```

Use the configured server port if it differs from `3002`. Some clients name this transport `http`; choose Streamable HTTP rather than legacy SSE. `plugin.json` and `mcp.json` describe the same local connection for Agent Plugins hosts. No host settings are changed automatically.

The endpoint uses the same local Host, browser Origin, and cross-site checks as the dashboard API. POST requests require `X-SocialSync-Client: 1`. It is not exposed through the public media/OAuth tunnel. This is a local, single-user integration without remote authentication; connect from a client on the same computer.

The MCP SDK handles initialization, tool discovery, tool calls, JSON-RPC errors, and protocol header validation. Requests are stateless and return JSON; there is no session ID, standalone SSE stream, or session deletion endpoint. GET and DELETE return `405 Method Not Allowed`. POST bodies are limited to 1 MiB. Native MCP clients set the required protocol headers; manual requests need `Content-Type: application/json` and `Accept: application/json, text/event-stream` in addition to the local-app header.

Run the existing worker (`pnpm worker`, or the development server's worker) for scheduled/immediate publication to progress. Only one worker should own the database. Use `get_status` to check its heartbeat; the readiness flags describe configuration, not a live provider or tunnel probe. Rebuild production output after changing server source.

## Optional stdio connection

Clients that spawn a local MCP process can still use the original stdio launcher:

```json
{
  "mcpServers": {
    "socialsync": {
      "command": "node",
      "args": ["/absolute/path/to/socialsync/scripts/mcp.mjs"]
    }
  }
}
```

Build first with `pnpm build`. For a manual stdio launch, run `pnpm -s mcp`; it waits for MCP messages on stdin. The root launcher anchors `.env` and relative `DATA_DIR` resolution to `apps/server`, even when the client starts it from another directory. Existing environment values take precedence over `.env`. Use the same `DATA_DIR` and `ENCRYPTION_KEY` as your API and worker. This alternative does not require the HTTP server to be running. Stdout is reserved for MCP JSON-RPC; diagnostics go to stderr.

## Tools

| Tools                                               | Behavior                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `get_status`                                        | Worker heartbeat and media delivery configuration                                             |
| `list_projects`, `create_project`, `update_project` | Discover and manage project names/time zones                                                  |
| `list_accounts`                                     | Global library, or only assigned accounts when `projectId` is supplied                        |
| `assign_account`, `remove_account_assignment`       | Manage explicit project assignments; pending/uncertain work prevents removal                  |
| `list_pinterest_boards`                             | Read board IDs for an assigned Pinterest account using the shared authorization lock          |
| `list_media`, `upload_media`, `delete_media`        | Project media metadata, local file import, and deletion of unused media                       |
| `list_posts`, `get_post`                            | Drafts, schedules, destination IDs, publication results and errors                            |
| `create_post`, `update_post`                        | Save a draft; update replaces the complete input and resets editable scheduled posts to draft |
| `schedule_post`                                     | Authorize publication at a future ISO 8601 timestamp with offset                              |
| `publish_post`                                      | Authorize immediate publication through the durable worker                                    |
| `cancel_post`                                       | Cancel remaining safe queued work while preserving in-flight and uncertain publications       |
| `retry_destination`                                 | Explicitly resume an eligible destination using persisted checkpoints                         |
| `resolve_destination`                               | Record a verified platform outcome before an uncertain destination can be retried             |

Tool success returns `{ "data": ... }` in both text JSON and structured content. Tool failures return `isError: true` and a safe message. IDs use the existing UUID contracts. Every project resource tool requires `projectId`; account credentials remain global and never appear in results. Developer app setup, OAuth connection, and global disconnection remain in the local dashboard.

## Typical workflow

1. Call `list_projects` and `list_accounts` for the intended project. Assign a global account explicitly if needed.
2. Use `list_media`, or `upload_media` with `{projectId, path}` for a user-selected absolute local path. Imports preserve the source, validate supported file signatures, and enforce `MAX_UPLOAD_BYTES`. Sources inside SocialSync's managed media directory are rejected; use that project's media IDs instead. PNG, WebP and still GIF originals remain intact; Instagram prepares its separate JPEG when publishing.
3. Call `create_post` with `{projectId, input: {caption, mediaIds, targets}}`. Each target needs `accountId` and `format`; use shared platform fields such as Pinterest `boardId` or YouTube `title`, `privacy`, and `madeForKids` as appropriate. Saving a draft does not publish it.
4. Read `get_post` to review the saved draft. Only when requested, call `schedule_post` with `{projectId, postId, scheduledAt}` or `publish_post` with `{projectId, postId}`. These return queue state, not proof of publication.
5. Inspect `get_post` for final destination results. For `needs_attention`, check the real platform first. `resolve_destination` requires `{projectId, postId, jobId, verified: true, resolution}`; `published` also requires `remoteId`. Resolving as `not_published` makes retry available but does not queue it. Never automatically resend an uncertain publication.

Connecting a local MCP client gives it access to this single-user SocialSync installation and user-selected local media imports. Keep the MCP process local; the public tunnel continues to expose only signed media and browser-bound OAuth callbacks. Do not publish the database, `.env`, or media directory as part of a plugin package.
