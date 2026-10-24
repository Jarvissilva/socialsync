# SocialSync

Self-hosted social publishing, in one workspace.

Connect your accounts, prepare posts, and schedule content for Instagram, Facebook, Pinterest, and YouTube. Keep your database and original media on your machine.

[Get started](#get-started) · [Highlights](#highlights) · [Your first post](#your-first-post) · [Documentation](#documentation)

SocialSync is a local-first publishing manager built with React, Node.js, SQLite, and TypeScript. Organize content into projects and choose which connected accounts each project can use.

## Highlights

| Feature | What you can do |
| --- | --- |
| Projects | Keep separate posts, media, calendars, time zones, and publishing history. |
| Account library | Connect accounts once and explicitly assign them to projects. |
| Compose & media | Upload original media, save drafts, and prepare content for multiple destinations. |
| Scheduling | Publish now or schedule in your project's time zone with a persistent background worker. |
| Publishing history | Review each destination's status, failures, and uncertain outcomes before retrying. |
| Media delivery | Serve signed media through an HTTPS tunnel or use a private Cloudflare R2 cache. |
| MCP | Work with projects, media, drafts, schedules, and publication outcomes from a trusted MCP client. |

Available formats depend on the platform and account type. SocialSync does not crop or transcode videos, add licensed music, or provide interactive Story stickers. Platform permissions, app review, and quotas still apply.

## Get started

Requires **Node.js 22.13+** and **pnpm 10.22.0**. Native dependencies may need a C++ build toolchain when prebuilt binaries are unavailable.

From your source checkout:

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
```

Open **http://127.0.0.1:5174**. The API runs on port `3002`; development starts the API and publishing worker together.

`setup:local` creates `apps/server/.env` with a random encryption key. It preserves an existing file. Keep `ENCRYPTION_KEY` unchanged and include it in your backups: saved account tokens and developer-app secrets depend on it.

You can create projects and prepare drafts immediately. Before connecting accounts or publishing, configure developer apps and media delivery as described below.

SocialSync has no application authentication. Keep the dashboard on localhost. Only signed media links and browser-bound OAuth callbacks are intended for public tunnel access.

## Your first post

1. Create a project from Home and choose its time zone.
2. Open **Accounts → Accounts config** and add your Meta, Pinterest, or YouTube developer-app credentials.
3. Register the displayed callback URL with the provider, then connect an account in the account library.
4. Assign the connected account to your project.
5. Upload media and open Compose to choose destinations and prepare your post.
6. Save a draft, review the content and destinations, then publish or schedule it.

For platforms that fetch media by URL, configure an HTTPS media tunnel or private R2 cache first. Scheduling uses the project's time zone. Editing a scheduled post returns it to a draft; schedule it again after editing.

Keep the computer online and the worker running for scheduled publishing. A failed destination does not resend destinations that already succeeded. Uncertain outcomes require checking the platform before retrying.

## Developer apps & media

Manage named developer apps in **Accounts → Accounts config**. Credentials are encrypted on the server and shared authorizations coordinate publishing and refresh across projects. New Facebook and Instagram connections use combined Meta login; Facebook Pages and supported professional Instagram accounts are available as destinations.

Set `OAUTH_ORIGIN` in `apps/server/.env` to the callback origin registered with each provider. Use your HTTPS tunnel origin when required, and start authorization in the same browser as the dashboard.

Original media stays local in both delivery modes:

- **Local tunnel:** keep `MEDIA_DELIVERY=local`, forward an HTTPS tunnel to the API port, and set `PUBLIC_MEDIA_ORIGIN`.
- **Private R2 cache:** set `MEDIA_DELIVERY=r2` and the `R2_*` values in `.env`. Keep the bucket private and retain local originals; cached copies are disposable.

See [provider setup and supported accounts](docs/guide.md#connect-developer-apps), [media delivery configuration](docs/guide.md#media-delivery), and [scheduler recovery](docs/guide.md#scheduler-and-recovery).

## Data storage

The default data directory is outside the repository:

```text
~/.local/share/socialsync/
├── socialsync.sqlite
└── media/
```

Existing installations may retain `socialdesk.sqlite`; SocialSync continues using it when present. Set `DATA_DIR` to override the directory. Relative overrides resolve from `apps/server` with the supplied commands; use an absolute path instead of a literal `~` in `.env`. Changing this setting does not move existing data.

Stop the API, worker, and stdio MCP processes before moving or backing up data. Copy the complete directory, including SQLite `-wal` and `-shm` files, and preserve `apps/server/.env` with the same encryption key. Data and `.env` are excluded from Git. See [backup and restore guidance](docs/guide.md#data-and-backups).

## Documentation

### Run in production

Build and start the background services with PM2 installed:

```sh
pnpm build
pm2 start ecosystem.config.cjs
pm2 save
```

Open **http://127.0.0.1:6003**. Express serves the built UI and API; PM2 runs a separate publishing worker. Both load `apps/server/.env`.

Stop any existing development server or worker using the same database before starting production. Use `OAUTH_ORIGIN=http://127.0.0.1:6003` for local callbacks, or preserve your registered HTTPS callback origin. Forward media tunnels to port `6003` with this setup.

After rebuilding, restart with `pm2 restart ecosystem.config.cjs --update-env`. A PM2 startup service is needed to restore saved processes after reboot. See [production setup](docs/guide.md#production-build-on-your-computer) for manual startup and configuration details.

### Connect an MCP client

MCP starts with the API. For the PM2 setup, use a client that supports Streamable HTTP:

```json
{
  "mcpServers": {
    "socialsync": {
      "url": "http://127.0.0.1:6003/mcp",
      "headers": {
        "X-SocialSync-Client": "1"
      }
    }
  }
}
```

Use port `3002` during development or the default manual production setup. Connect only trusted local clients: MCP has access to the workspace. Publishing and scheduling tools perform real actions; invoke them only when intended.

See [MCP configuration and tools](docs/mcp.md), including the alternative stdio launcher.

### Development

| Directory | Purpose |
| --- | --- |
| `apps/client` | React UI, Vite, React Router, and shadcn/ui. |
| `apps/server` | Express API, SQLite, provider integrations, and publishing worker. |
| `packages/shared` | Shared TypeScript contracts and validation. |

```sh
pnpm dev        # Start the client, API, and publishing worker
pnpm test       # Run server and client tests
pnpm lint
pnpm typecheck
pnpm build
```

Development uses port `5174` for the UI and proxies `/api` and `/public` to port `3002`. Tests use isolated temporary databases and mocked providers; setup and tests never publish real content. API integration tests require local listening sockets.

For detailed configuration, authorization behavior, recovery, and architecture, read the [full guide](docs/guide.md). See the [API overview](docs/api.md) for project and account boundaries.
