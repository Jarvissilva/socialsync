# API boundaries

The UI uses relative `/api` URLs. Mutations require `X-SocialDesk-Client: 1` and JSON except media upload, which uses multipart form field `file`. Server inputs and shared responses are validated with Zod. Error responses have `{ "error": "Useful message" }`.

## Global resources

| Method     | Path                                  | Behavior                                                            |
| ---------- | ------------------------------------- | ------------------------------------------------------------------- |
| GET        | `/api/health`                         | Worker heartbeat and media-origin configuration status              |
| GET        | `/api/providers`                      | Developer configuration readiness, without credentials              |
| GET / POST | `/api/projects`                       | List / create projects                                              |
| PUT        | `/api/projects/:projectId`            | Rename project and update time zone                                 |
| GET        | `/api/accounts`                       | Shared library, connection status, project assignments              |
| POST       | `/api/accounts/connect/:provider`     | Begin OAuth; optional `projectId` and `reconnectAccountId`          |
| GET / POST | `/api/accounts/discoveries/:id`       | Inspect / save selected discovered destinations                     |
| GET        | `/api/accounts/:accountId/impact`     | Projects, accounts, and pending destinations affected by disconnect |
| POST       | `/api/accounts/:accountId/disconnect` | Confirm and disconnect the shared authorization                     |

Authorization providers (`meta`, `pinterest`, `youtube`, and legacy `instagram` / `facebook`) are distinct from account platforms. Provider status and discovery responses expose `provider`; accounts expose both `provider` and `platform`, and each discovery candidate has its own `platform`. New connections use `meta` for Facebook and Instagram together. The legacy Instagram route is reserved for reconnecting existing direct Instagram Login accounts.

One connection can authorize multiple destinations, such as Facebook Pages and their linked professional Instagram accounts. The library prevents duplicate destinations by `(platform, externalId)`. Each project assignment references an existing library identity; credentials are not copied into the project.

## Project resources

All paths below are prefixed with `/api/projects/:projectId`.

| Method     | Path                                         | Behavior                                                                                                                        |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| GET / POST | `/accounts`                                  | List assignments / add `{accountId}`                                                                                            |
| DELETE     | `/accounts/:accountId`                       | Remove assignment when no pending or uncertain work depends on it                                                               |
| GET        | `/accounts/:accountId/boards`                | List Pinterest boards for an assigned account                                                                                   |
| GET / POST | `/media`                                     | List / upload project media                                                                                                     |
| GET        | `/media/:mediaId/file`                       | Local project media delivery                                                                                                    |
| DELETE     | `/media/:mediaId`                            | Delete unused media                                                                                                             |
| GET / POST | `/posts`                                     | List / create drafts                                                                                                            |
| GET / PUT  | `/posts/:postId`                             | Read / edit a draft; editable scheduled posts return to draft                                                                   |
| POST       | `/posts/:postId/schedule`                    | `{scheduledAt: ISO8601}` or `{immediate: true}`                                                                                 |
| POST       | `/posts/:postId/cancel`                      | Cancel remaining safe queued destinations; preserve in-flight and uncertain outcomes                                            |
| POST       | `/posts/:postId/destinations/:jobId/retry`   | Explicitly resume an eligible failed, paused, or missed destination                                                             |
| POST       | `/posts/:postId/destinations/:jobId/resolve` | Manual outcome review: `{verified: true, resolution: "published", remoteId}` or `{verified: true, resolution: "not_published"}` |

A draft contains `title`, shared `caption`, ordered `mediaIds`, and `targets`. Each target specifies `accountId`, `format`, and optional caption/title overrides, Pinterest `boardId`, destination `link`, YouTube `privacy`, and `madeForKids`. Requests may reference only media and account assignments belonging to the path's project. Published/processing posts cannot be edited; duplicate them into a new draft.

The worker uses the same ownership boundaries and checks current assignments before publishing. All database operations use parameter binding. Job claims and assignment mutations run in SQLite transactions. Shared connection locks coordinate token use; only the encrypted token service sees OAuth secrets.

Public callback routes live at `/public/oauth/:provider/callback`. Public media links at `/public/media/:projectId/:mediaId` require HMAC signatures binding the project, file, and expiry. They do not permit browsing the media library.
