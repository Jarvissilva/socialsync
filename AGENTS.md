# SocialSync

- Use pnpm, TypeScript, ESM, and the existing workspace: `apps/client`, `apps/server`, `packages/shared`.
- Follow OutreachIt's architecture and UI patterns, but do not introduce dependencies on its repository, database, credentials, or data directories.
- Keep connected account credentials global. Projects reference explicit account assignments; posts, media, schedules, and publishing history belong to exactly one project.
- Scope all project lookups and mutations by `projectId`. Never accept another project's media, jobs, posts, or unassigned accounts.
- Keep secrets, provider calls, database access, and the durable publishing worker on the server. Never expose tokens in API responses or logs.
- Persist remote IDs and upload checkpoints. Unknown publishing outcomes must not automatically resend. Shared authorizations coordinate token refresh and publishing across projects.
- Keep the dashboard local. Only signed media and browser-bound OAuth callbacks are intended for public tunnel access.
- Use isolated temporary databases and mocked providers in tests. Never publish real content as part of setup, tests, or seeding.
- Keep changes focused and type safe. Do not discard user changes or commit/push without explicit instructions.
- Run relevant tests, `pnpm lint`, `pnpm typecheck`, and `pnpm build`; inspect the final diff and state any verification limits.
