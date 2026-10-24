# SocialSync guide

A local social publishing workspace for Instagram, Facebook, Pinterest, and YouTube. Built with Vite, React, React Router, TypeScript, shadcn/ui, Express, and SQLite.

Connect an account once in the **Account library**, then explicitly add it to projects. Each project has its own posts, drafts, media, calendar, time zone, and publishing history. This app does not use OutreachIt's database, credentials, or media directories.

## Run locally

Requires Node.js 22.13+ and pnpm 10.22.0. Dependencies include the native `better-sqlite3` module; platforms without a prebuilt binary need a working C++ build toolchain.

```sh
pnpm install
pnpm setup:local
pnpm dev
```

Open **http://127.0.0.1:5174**. The API runs at `127.0.0.1:3002`. These ports differ from OutreachIt's defaults so both apps can run together. Development starts the API and publishing worker together. If an existing worker or a recent watch restart holds the scheduler lease, the API stays available and worker startup retries until the lease can be acquired. It never starts a second worker against an active lease. Closing the browser does not stop the worker; stopping the command does.

`setup:local` creates `apps/server/.env` with a random encryption key and restrictive file permissions. It never replaces an existing file. Keep the same encryption key when restarting, updating, or restoring a backup.

Create a project, configure developer credentials, connect an account in the library, add it to your project, upload media, and compose a post. Drafts can be incomplete; publishing validates each selected destination. Scheduling uses the **project's time zone**, independently of your computer's zone. Editing a scheduled post returns it to a draft; schedule it again after editing.

## Connect developer apps

Open **Accounts → Accounts config** to save named Meta, Pinterest, and YouTube developer-app configurations. Each includes a client ID and a secret encrypted in SQLite with `ENCRYPTION_KEY`. You can rename an app or replace its secret; provider and client ID are immutable. A different developer app needs a new configuration. Saved secrets are never returned to the browser. The page displays the exact callback URL and linked-account count.

Choose an app when connecting an account (a single compatible app is preselected). Reconnect and token refresh use the app saved on the connection. Connections cannot silently switch developer apps. Secret replacement is blocked during active OAuth, account selection, publishing, and refresh; deletion requires no linked connections or active flows, including disconnected connections. New Facebook and Instagram connections use combined Meta login; legacy Facebook and direct Instagram configurations remain available for existing reconnections.

| Platform                 | Legacy import variables                            | Redirect path                      |
| ------------------------ | ------------------------------------------------ | ---------------------------------- |
| Facebook & Instagram     | `META_APP_ID`, `META_APP_SECRET`                 | `/public/oauth/meta/callback`      |
| Existing Instagram Login | `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET` | `/public/oauth/instagram/callback` |
| Pinterest                | `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET` | `/public/oauth/pinterest/callback` |
| YouTube                  | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`     | `/public/oauth/youtube/callback`   |

Register the exact redirect URI formed from `OAUTH_ORIGIN` plus the path above. For example: `http://127.0.0.1:3002/public/oauth/youtube/callback`. If a provider requires HTTPS, use your tunnel's HTTPS origin for `OAUTH_ORIGIN` and register that exact URL. Start authorization from the same browser you use for the app; OAuth callbacks require a matching, short-lived browser cookie.

- **Facebook & Instagram:** Choose **Connect Facebook & Instagram**. Facebook Login requests `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, and `instagram_content_publish`. Select Facebook Pages and/or their linked professional Instagram Business or Creator accounts in one dialog. A Page without linked Instagram remains available as a Facebook destination. Only selected destinations are saved and assigned to the chosen project. Personal Facebook profiles and consumer Instagram accounts are unsupported. Instagram images must be JPEG. Facebook Login discovery does not establish Business-only Story eligibility, so these Instagram connections offer images, carousels, and Reels. Existing direct Instagram Login connections still offer Stories when discovery identifies a Business account. Instagram publishing uses Facebook Graph and the linked Page token. Configure `META_GRAPH_VERSION` for your developer app.
- **One-time credential import:** Before the API accepts requests or the worker processes jobs, complete legacy environment pairs are imported transactionally into encrypted provider-app records. If both `META_APP_ID` and `META_APP_SECRET` are unset, the complete `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` pair also supplies the Meta configuration. Credential halves are never mixed. Existing connections and unexpired OAuth/discovery records are linked to the applicable imported configuration. A persistent import marker prevents later restarts from recreating deleted apps or overwriting interface-managed credentials. After the first successful startup, database configurations are authoritative: verify imported apps in the interface, then the old provider ID/secret variables listed above (including Facebook compatibility variables) can be removed. Keep `ENCRYPTION_KEY`, R2 settings, and other runtime settings in `.env`. The app never edits `.env`.
- **Incomplete credentials:** Affected existing connections show **App setup required** and keep their tokens, IDs, assignments, and publishing history. Refresh and reconnect require an explicit compatible app selection through Reconnect; SocialSync never guesses which app originally authorized them. Unbound in-flight attempts need to be restarted after app setup.
- **Existing Instagram Login:** Keep the original Instagram callback registered; the complete original credential pair is imported into a legacy provider-app configuration. These accounts keep their original authorization, `instagram_business_basic` / `instagram_business_content_publish` permissions, Instagram Graph host, token refresh, internal IDs, assignments, and history. Use their library **Reconnect** control; new accounts use combined Meta login. Selecting an already connected direct Instagram identity in a new Meta connection returns a conflict instead of replacing its authorization.
- **Shared access:** Reconnect and disconnect confirmations list every affected Facebook/Instagram destination and project. Reconnection requires access to every existing destination sharing the authorization, preserves all their IDs, and is blocked while publishing holds that authorization. Disconnect pauses pending work across its projects; reconnecting never automatically republishes it.
- **Pinterest:** `boards:read`, `pins:read`, `pins:write`, and `user_accounts:read`. Choose a board in the composer. Trial access can limit newly created Pins to visibility only for their creator; verify the app's access tier before expecting public publication.
- **YouTube:** Enable YouTube Data API v3 and configure OAuth with `youtube.upload` and `youtube.readonly`. Each saved identity represents a channel. Visibility and channel/API-project restrictions still apply. Shorts classification is determined by YouTube from the media, not a separate Shorts upload endpoint.

App review, permissions, account eligibility, quotas, and media restrictions remain platform-controlled. The app validates basic content structure and reports provider failures. It does not transcode, crop, add licensed music, or offer interactive Story stickers. Every adapter is covered by mocked-provider tests; real account authorization and format acceptance must still be verified with your developer apps. No real social content is published by setup or tests.

References: [Meta Instagram with Facebook Login](https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login), [Facebook Page posts](https://developers.facebook.com/docs/pages-api/posts/), [Pinterest organic content](https://developer.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/), [YouTube resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol).

## Media delivery

Original uploads, previews, deletion, and backups stay local in both modes. The default `MEDIA_DELIVERY=local` uses the media tunnel below. To use your existing private R2 bucket as a publishing cache, set these values only in `apps/server/.env` and restart the API and worker:

```dotenv
MEDIA_DELIVERY=r2
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_BUCKET=<your-private-bucket>
R2_ACCESS_KEY_ID=<bucket-scoped-access-key-id>
R2_SECRET_ACCESS_KEY=<bucket-scoped-secret-access-key>
R2_KEY_PREFIX=socialsync
```

Create **Object Read & Write** credentials scoped to this bucket. Keep the bucket private; no public domain, `r2.dev` access, browser CORS configuration, or media tunnel is needed. Login and dashboard access stay on localhost. OAuth may still require its own HTTPS callback depending on the platform.

Copies are created on demand at `<prefix>/<projectId>/<mediaId>`. Existing media needs no migration or bulk upload. SocialSync checks metadata against the local file, streams missing or changed copies with their MIME type, and refreshes copies at least five days old. It generates a signed GET URL valid for 24 hours immediately before a platform needs it. URLs remain server-side and are not saved in publishing checkpoints. YouTube and Pinterest video uploads continue to use local bytes. R2 failures never fall back to the tunnel; preparation failures can be retried safely before publication begins. Existing failed destinations still require explicit retry or outcome resolution and are never automatically reset.

In the R2 bucket's **Settings → Object lifecycle rules**, add a rule applying **only to the prefix `socialsync/`** (or your configured `R2_KEY_PREFIX` followed by `/`) that deletes objects seven days after their last modification. Do not change unrelated rules, policies, or objects. R2 copies are disposable: local deletion keeps its existing behavior and cached copies expire under this rule. Published posts retain the platform's own media copy. Keep local originals and backups; the cache is not a backup. Health reports configuration readiness only, without making an R2 network request.

References: [R2 AWS SDK v3 and presigning](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/), [R2 object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

### Local media tunnel

For platforms that fetch media by URL, configure a temporary HTTPS tunnel forwarding to `http://127.0.0.1:3002`. For example, with `cloudflared` installed:

```sh
cloudflared tunnel --url http://127.0.0.1:3002
```

Set `PUBLIC_MEDIA_ORIGIN` to the resulting HTTPS origin and restart the API/worker. If the address changes, update it and any registered HTTPS OAuth callbacks. Preserve the public Host header; do not configure a host-header override to `localhost`.

Only `/public/media/...` with a valid, project-bound signature and `/public/oauth/...` callbacks are intended for tunnel access. Media links expire after 24 hours and are generated when publishing starts. Dashboard and API management requests reject public hostnames. Do not expose the application directly to a LAN or the internet: this is a single-user local tool without application authentication. A configured origin does not prove that a tunnel is currently reachable.

## Scheduler and recovery

- Schedules persist in SQLite, stored as UTC instants. The worker checks due work every 15 seconds; platform upload and processing time can delay publication.
- Each destination has independent status and history. A successful destination is never republished because another destination failed.
- A shared authorization lock serializes publishing and token refresh across projects. The worker respects provider rate-limit responses with bounded exponential backoff.
- Upload sessions, remote identifiers, processing checkpoints, and attempts survive restarts. YouTube video bytes upload in resumable 8 MiB chunks.
- Missed, untouched posts more than 30 seconds overdue at worker startup need your attention. Publish them now, cancel, or create a new scheduled draft; they are not silently released in a batch.
- Safe processing checkpoints resume after stale leases. Uncertain writes are held for review. In post details, check the real destination, then record its post ID or explicitly confirm it was not published before retrying.
- Removing a project assignment is blocked by pending or uncertain work. Disconnecting a shared authorization pauses pending jobs in every affected project, including Facebook and Instagram destinations sharing that authorization. Reconnect, then explicitly resume affected destinations.

Keep the computer awake, online, and running the worker, plus the tunnel when using local media delivery. Automatic posting is not guaranteed while your computer is asleep or off.

## Production build on your computer

```sh
pnpm build
```

Set `APP_ORIGIN=http://127.0.0.1:3002` in the server environment. Then start the app:

```sh
pnpm start
```

Open **http://127.0.0.1:3002**. One server process serves the built client, API, and MCP endpoint and runs the publishing worker. Only one publishing worker may run against a database at a time. Stop the development server before starting production on the same port. For unattended local use, configure your operating system's process manager to launch the app from this repository and preserve `apps/server/.env`.

### PM2 on port 6003

The ecosystem file runs one process for the web app and publishing worker, loading `apps/server/.env`:

```sh
pnpm build
pm2 start ecosystem.config.cjs
```

Open **http://127.0.0.1:6003**. The MCP endpoint is **http://127.0.0.1:6003/mcp**. The PM2 configuration sets the local host, port, and app origin. If OAuth uses a local callback, set `OAUTH_ORIGIN=http://127.0.0.1:6003` in `apps/server/.env` and update the registered provider redirect URLs; preserve your HTTPS OAuth origin when using a tunnel. Stop any existing publishing worker for this database before starting the PM2 app.

After rebuilding, run `pm2 restart ecosystem.config.cjs --update-env`. Run `pm2 save` to persist the process list for an existing PM2 startup service.

## MCP integration

The MCP endpoint starts automatically with the app server (`pnpm dev` or `pnpm start`). Connect your MCP client using Streamable HTTP at `http://127.0.0.1:3002/mcp` with the header `X-SocialSync-Client: 1`. It exposes projects, assigned accounts, media imports, drafts, scheduling, and publication outcome review using the same database and worker. The separate stdio launcher remains available. See [MCP setup and tools](mcp.md).

## Data and backups

By default, the database and media live outside the repository in `~/.local/share/socialsync/`: `socialsync.sqlite` and `media/`. Existing installations continue using `socialdesk.sqlite` when present, preserving their accounts, projects, schedules, and publishing history. An explicit `DATA_DIR` overrides the default; relative overrides resolve from the server's working directory (`apps/server` with the provided commands). Use an absolute path rather than a literal `~` in `.env`. API, worker, and MCP must use the same directory and encryption key.

Before moving an existing installation, stop all development servers, API, publishing workers, and stdio MCP processes. Transfer the complete data directory, including SQLite WAL/SHM files, verify the copy and database integrity, then update `DATA_DIR` in `apps/server/.env`. Preserve the database filename and encryption key. After restarting, verify existing projects, accounts, media previews, and worker readiness without publishing content.

For a complete backup, stop API, worker, and stdio MCP processes, then copy the **entire configured data directory**, including any SQLite WAL files, plus **`apps/server/.env`** to a protected location. Restore all of them together. Do not generate a new encryption key for an existing database. Keep backups private: captions and media are local plaintext; authorization tokens and developer-app secrets are encrypted in SQLite with the environment key. Restoring the database without the same `ENCRYPTION_KEY` makes both unreadable. Database schema migrations run before requests or worker execution and fail startup if they cannot complete.

## Workspace and checks

```text
apps/client/       React Router feature loaders/actions, layouts, pages, UI, hooks
apps/server/       Express routes, workflow services, database, API and publishing worker
packages/shared/   Public types, Zod contracts, content validation
```

```sh
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

The frontend uses React Router 7.18.4 Data Mode in the Vite SPA. Feature modules in `apps/client/src/routes/` own validated API reads and mutations. The `root` loader supplies the project directory and account library; the `project` loader resolves the URL’s project and scheduler health. Page loaders provide posts, composer data, media, accounts, and settings. Lazy components consume loader data; dialogs load provider readiness, discoveries, disconnect impact, and boards through fetchers.

Actions validate explicit intents and use the existing Express API. Forms and fetcher submissions expose pending states and inline API errors; unexpected failures go to route boundaries. Successful actions automatically revalidate route data. OAuth uses a full document redirect. Draft saves stay in the composer, while scheduling and publishing redirect to Posts. A scheduling failure returns the saved draft ID so retries update the same draft.

Router revalidation runs on window focus and every 15 seconds within project views for posts and scheduler health, skipping hidden tabs, active submissions, and overlapping refreshes. Local editor, filter, and dialog state survive revalidation; changing projects remounts the workspace. API requests receive the router request’s abort signal, and API errors retain their HTTP status. The Express API and durable worker retain their project boundaries and publishing safeguards.

Tests use isolated temporary databases and mocked platform calls. API integration tests require local listening sockets. They never access your real database or social credentials. See [the API overview](api.md) for project and account boundaries.
