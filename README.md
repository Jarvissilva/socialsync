# SocialDesk

A local social publishing workspace for Instagram, Facebook, Pinterest, and YouTube. Built with Vite, React, React Router, TypeScript, shadcn/ui, Express, and SQLite.

Connect an account once in the **Account library**, then explicitly add it to projects. Each project has its own posts, drafts, media, calendar, time zone, and publishing history. This app does not use OutreachIt's database, credentials, or media directories.

## Run locally

Requires Node.js 22.13+ and pnpm 10.22.0. Dependencies include the native `better-sqlite3` module; platforms without a prebuilt binary need a working C++ build toolchain.

```sh
pnpm install
pnpm setup:local
pnpm dev
```

Open **http://127.0.0.1:5174**. The API runs at `127.0.0.1:3002`. These ports differ from OutreachIt's defaults so both apps can run together. Development starts the API and publishing worker together. Closing the browser does not stop the worker; stopping the command does.

`setup:local` creates `apps/server/.env` with a random encryption key and restrictive file permissions. It never replaces an existing file. Keep the same encryption key when restarting, updating, or restoring a backup.

Create a project, configure developer credentials, connect an account in the library, add it to your project, upload media, and compose a post. Drafts can be incomplete; publishing validates each selected destination. Scheduling uses the **project's time zone**, independently of your computer's zone. Editing a scheduled post returns it to a draft; schedule it again after editing.

## Connect developer apps

Enter credentials in `apps/server/.env`, then restart the API and worker. Secrets never belong in Vite variables or the browser. New Facebook and Instagram connections use one combined Meta login with the same app ID and secret. Pinterest and YouTube have separate OAuth flows.

| Platform                 | Environment variables                            | Redirect path                      |
| ------------------------ | ------------------------------------------------ | ---------------------------------- |
| Facebook & Instagram     | `META_APP_ID`, `META_APP_SECRET`                 | `/public/oauth/meta/callback`      |
| Existing Instagram Login | `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET` | `/public/oauth/instagram/callback` |
| Pinterest                | `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET` | `/public/oauth/pinterest/callback` |
| YouTube                  | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`     | `/public/oauth/youtube/callback`   |

Register the exact redirect URI formed from `OAUTH_ORIGIN` plus the path above. For example: `http://127.0.0.1:3002/public/oauth/youtube/callback`. If a provider requires HTTPS, use your tunnel's HTTPS origin for `OAUTH_ORIGIN` and register that exact URL. Start authorization from the same browser you use for the app; OAuth callbacks require a matching, short-lived browser cookie.

- **Facebook & Instagram:** Choose **Connect Facebook & Instagram**. Facebook Login requests `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, and `instagram_content_publish`. Select Facebook Pages and/or their linked professional Instagram Business or Creator accounts in one dialog. A Page without linked Instagram remains available as a Facebook destination. Only selected destinations are saved and assigned to the chosen project. Personal Facebook profiles and consumer Instagram accounts are unsupported. Instagram images must be JPEG. Facebook Login discovery does not establish Business-only Story eligibility, so these Instagram connections offer images, carousels, and Reels. Existing direct Instagram Login connections still offer Stories when discovery identifies a Business account. Instagram publishing uses Facebook Graph and the linked Page token. Configure `META_GRAPH_VERSION` for your developer app.
- **Credential compatibility:** If both `META_APP_ID` and `META_APP_SECRET` are unset, the existing `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` pair is used. Register the new `/public/oauth/meta/callback` URI on that same app. Existing Facebook callback URIs remain supported for in-flight authorization attempts. Do not combine credential halves from different apps.
- **Existing Instagram Login:** Keep the original `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`, and Instagram callback registered. These accounts keep their original authorization, `instagram_business_basic` / `instagram_business_content_publish` permissions, Instagram Graph host, token refresh, internal IDs, assignments, and history. Use their library **Reconnect** control; new accounts use combined Meta login. Selecting an already connected direct Instagram identity in a new Meta connection returns a conflict instead of replacing its authorization.
- **Shared access:** Reconnect and disconnect confirmations list every affected Facebook/Instagram destination and project. Reconnection requires access to every existing destination sharing the authorization, preserves all their IDs, and is blocked while publishing holds that authorization. Disconnect pauses pending work across its projects; reconnecting never automatically republishes it.
- **Pinterest:** `boards:read`, `pins:read`, `pins:write`, and `user_accounts:read`. Choose a board in the composer. Trial access can limit newly created Pins to visibility only for their creator; verify the app's access tier before expecting public publication.
- **YouTube:** Enable YouTube Data API v3 and configure OAuth with `youtube.upload` and `youtube.readonly`. Each saved identity represents a channel. Visibility and channel/API-project restrictions still apply. Shorts classification is determined by YouTube from the media, not a separate Shorts upload endpoint.

App review, permissions, account eligibility, quotas, and media restrictions remain platform-controlled. The app validates basic content structure and reports provider failures. It does not transcode, crop, add licensed music, or offer interactive Story stickers. Every adapter is covered by mocked-provider tests; real account authorization and format acceptance must still be verified with your developer apps. No real social content is published by setup or tests.

References: [Meta Instagram with Facebook Login](https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login), [Facebook Page posts](https://developers.facebook.com/docs/pages-api/posts/), [Pinterest organic content](https://developer.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/), [YouTube resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol).

## Media tunnel

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

Keep the computer awake, online, and running both the worker and tunnel. Automatic posting is not guaranteed while your computer is asleep or off.

## Production build on your computer

```sh
pnpm build
```

Set `APP_ORIGIN=http://127.0.0.1:3002` in the server environment. Then run these in separate terminals:

```sh
pnpm start
pnpm worker
```

Open **http://127.0.0.1:3002**. Express serves the built client and API on one origin. Only one publishing worker may run against a database at a time. Stop the development server before starting production on the same port. For unattended local use, configure your operating system's process manager to launch both commands from this repository and preserve `apps/server/.env`.

## Data and backups

By default, `data/socialdesk.sqlite` and `data/media/` belong solely to this app. `DATA_DIR` is resolved relative to the server's working directory (`apps/server` with the provided commands). Changing it creates or opens an independent installation; it does not import OutreachIt data.

For a complete backup, stop API and worker, then copy the **entire `data/` directory**, including any SQLite WAL files, plus **`apps/server/.env`** to a protected location. Restore all of them together. Do not generate a new encryption key for an existing database. Keep backups private: captions and media are local plaintext; authorization tokens are encrypted with the environment key. Migrations run before requests or worker execution and fail startup if they cannot complete.

## Workspace and checks

```text
apps/client/       React Router feature loaders/actions, layouts, pages, UI, hooks
apps/server/       Express routes, workflow services, database, API and worker entrypoints
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

Tests use isolated temporary databases and mocked platform calls. API integration tests require local listening sockets. They never access your real database or social credentials. See [the API overview](docs/api.md) for project and account boundaries.
