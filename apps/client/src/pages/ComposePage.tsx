import { useRef, useState } from "react";
import {
  useParams,
  useLoaderData,
  useBlocker,
  useBeforeUnload,
  useSearchParams,
  Link,
} from "react-router";
import {
  useRouteMutation,
  useDialogLoader,
} from "@/hooks/use-route-interaction";
import type { composeLoader } from "@/routes/posts";
import type { boardsSchema } from "@/routes/accounts";
import { z } from "zod";
import {
  postInputSchema,
  targetInputSchema,
  platformNames,
  formatSchema,
  validateContent,
  type Post,
  type PostInput,
  type TargetInput,
  type Account,
  type Media,
} from "@social/shared";
import {
  Save,
  Send,
  CalendarClock,
  Plus,
  ImagePlus,
  Check,
  ArrowLeft,
  Upload,
  Eye,
} from "lucide-react";
import { useProject } from "@/layouts/ProjectLayout";
import { dateTimeInput } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlatformIcon } from "@/components/accounts/PlatformIcon";
import {
  EmptyState,
  ErrorMessage,
  Modal,
} from "@/components/feedback/Feedback";
import { MediaPreview } from "@/pages/MediaPage";

export function ComposePage() {
  const project = useProject(),
    { postId } = useParams();
  const { accounts, media, post } = useLoaderData<typeof composeLoader>();
  return (
    <Composer
      key={`${project.id}:${postId || "new"}`}
      accounts={accounts}
      media={media}
      initial={post}
    />
  );
}
function Composer({
  accounts,
  media,
  initial,
}: {
  accounts: Account[];
  media: Media[];
  initial?: Post;
}) {
  const project = useProject();
  const [search] = useSearchParams();
  const initialInput = postInputSchema.parse(initial || {});
  const [input, setInput] = useState<PostInput>(initialInput),
    [postId, setPostId] = useState(initial?.id),
    [baseline, setBaseline] = useState(JSON.stringify(initialInput)),
    [picker, setPicker] = useState(false),
    [confirmation, setConfirmation] = useState<"schedule" | "publish" | null>(
      null,
    ),
    [time, setTime] = useState(() => {
      const day = search.get("date");
      return day && /^\d{4}-\d{2}-\d{2}$/.test(day)
        ? `${day}T09:00`
        : dateTimeInput(new Date(Date.now() + 3600_000), project.timeZone);
    });
  const uploadInput = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(input) !== baseline;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useBeforeUnload((event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  const selectedMedia = input.mediaIds
    .map((id) => media.find((m) => m.id === id))
    .filter((m): m is Media => Boolean(m));
  const upload = useRouteMutation<Media, File>(
    `/projects/${project.id}/media`,
    (file) => {
      const body = new FormData();
      body.set("intent", "upload-media");
      body.set("file", file);
      return body;
    },
    (m) => setInput((old) => ({ ...old, mediaIds: [...old.mediaIds, m.id] })),
  );
  const save = useRouteMutation<
    { postId: string; baseline: string },
    { intent: "draft" | "schedule" | "publish"; baseline: string }
  >(
    `/projects/${project.id}/compose`,
    ({ intent, baseline: submittedInput }) => {
      return {
        intent,
        input: submittedInput,
        postId: postId || "",
        time,
        timeZone: project.timeZone,
      };
    },
    (result) => {
      setPostId(result.postId);
      setBaseline(result.baseline);
      setConfirmation(null);
    },
    (result, submitted) => {
      if (!result.ok && result.savedPostId) {
        setPostId(result.savedPostId);
        setBaseline(submitted.baseline);
      }
    },
  );
  const saving = save.isPending,
    saveError = save.error;
  const submitSave = (intent: "draft" | "schedule" | "publish") =>
    save.mutate({ intent, baseline: JSON.stringify(input) });
  const updateTarget = (accountId: string, changes: Partial<TargetInput>) =>
    setInput((old) => ({
      ...old,
      targets: old.targets.map((t) =>
        t.accountId === accountId ? { ...t, ...changes } : t,
      ),
    }));
  const toggleAccount = (account: Account) =>
    setInput((old) => ({
      ...old,
      targets: old.targets.some((t) => t.accountId === account.id)
        ? old.targets.filter((t) => t.accountId !== account.id)
        : [
            ...old.targets,
            targetInputSchema.parse({
              accountId: account.id,
              format: account.capabilities[0] || "image",
            }),
          ],
    }));
  const validation = input.targets.flatMap((target) => {
    const account = accounts.find((a) => a.id === target.accountId);
    if (!account) return ["An account is no longer assigned to this project."];
    return validateContent(
      account.platform,
      { ...target, title: target.title || input.title },
      selectedMedia,
      input.caption,
    ).map((e) => `${account.name}: ${e}`);
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">FROM IDEA TO PUBLISHED</span>
          <h1>{initial ? "Edit post" : "Create a post"}</h1>
          <p>One idea. Every channel. Make it yours before it goes live.</p>
        </div>
        <Button variant="outline" asChild>
          <Link to={`/projects/${project.id}/posts`}>
            <ArrowLeft />
            All posts
          </Link>
        </Button>
      </div>
      <ErrorMessage error={saveError || upload.error} />
      <div className="composer-grid">
        <div className="composer-main">
          <section className="panel">
            <div className="panel-heading">
              <h2>Where are we posting?</h2>
              <span className="count">{input.targets.length} selected</span>
            </div>
            <div className="panel-body">
              {accounts.length ? (
                <div className="account-pills">
                  {accounts.map((a) => (
                    <button
                      key={a.id}
                      className={`account-pill ${input.targets.some((t) => t.accountId === a.id) ? "selected" : ""}`}
                      disabled={
                        a.status !== "connected" &&
                        !input.targets.some((t) => t.accountId === a.id)
                      }
                      onClick={() => toggleAccount(a)}
                    >
                      <PlatformIcon platform={a.platform} small />
                      {a.name}
                      {input.targets.some((t) => t.accountId === a.id) ? (
                        <Check size={13} />
                      ) : (
                        <Plus size={13} />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Add your first account"
                  description="Choose an account from your shared library to publish in this project."
                >
                  <Button variant="outline" asChild>
                    <Link to={`/projects/${project.id}/accounts`}>
                      Add accounts
                    </Link>
                  </Button>
                </EmptyState>
              )}
              {input.targets
                .filter(
                  (target) =>
                    !accounts.some(
                      (account) => account.id === target.accountId,
                    ),
                )
                .map((target) => (
                  <Button
                    key={target.accountId}
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setInput((old) => ({
                        ...old,
                        targets: old.targets.filter(
                          (t) => t.accountId !== target.accountId,
                        ),
                      }))
                    }
                  >
                    Remove unavailable account:{" "}
                    {initial?.targets.find(
                      (t) => t.accountId === target.accountId,
                    )?.accountName || "Unassigned account"}
                  </Button>
                ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Your content</h2>
              <span className="subtle">Start with the big idea</span>
            </div>
            <div className="panel-body form-stack">
              <label>
                Post title
                <Input
                  placeholder="Give this post a name…"
                  value={input.title}
                  maxLength={100}
                  onChange={(e) =>
                    setInput({ ...input, title: e.target.value })
                  }
                />
              </label>
              <label>
                Caption
                <Textarea
                  aria-label="Caption"
                  className="caption-input"
                  placeholder="What would you like to share?"
                  value={input.caption}
                  onChange={(e) =>
                    setInput({ ...input, caption: e.target.value })
                  }
                />
                <span className="character-count">
                  {input.caption.length.toLocaleString()} characters
                </span>
              </label>
              {selectedMedia.length > 0 && (
                <div className="selected-media">
                  {selectedMedia.map((m) => (
                    <div key={m.id}>
                      <MediaPreview media={m} />
                      <button
                        aria-label={`Remove ${m.name}`}
                        onClick={() =>
                          setInput({
                            ...input,
                            mediaIds: input.mediaIds.filter(
                              (id) => id !== m.id,
                            ),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="media-actions">
                <Button variant="outline" onClick={() => setPicker(true)}>
                  <ImagePlus />
                  Choose media
                </Button>
                <Button
                  variant="ghost"
                  disabled={upload.isPending}
                  onClick={() => uploadInput.current?.click()}
                >
                  <Upload />
                  {upload.isPending ? "Uploading…" : "Upload new"}
                </Button>
              </div>
              <input
                ref={uploadInput}
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate(file);
                  e.target.value = "";
                }}
              />
            </div>
          </section>
          {input.targets.map((target) => {
            const account = accounts.find((a) => a.id === target.accountId);
            if (!account) return null;
            return (
              <TargetEditor
                key={target.accountId}
                account={account}
                target={target}
                onChange={(changes) => updateTarget(target.accountId, changes)}
              />
            );
          })}
        </div>
        <aside className="composer-preview">
          <section className="panel">
            <div className="panel-heading">
              <h2>
                <Eye size={16} />
                Post preview
              </h2>
            </div>
            <div className="preview-content">
              <div className="preview-identity">
                <span className="project-avatar">
                  {project.name[0]?.toUpperCase()}
                </span>
                <div>
                  <strong>{project.name}</strong>
                  <small>
                    {input.targets.length
                      ? input.targets
                          .map(
                            (t) =>
                              platformNames[
                                accounts.find((a) => a.id === t.accountId)
                                  ?.platform || "instagram"
                              ],
                          )
                          .join(" · ")
                      : "Select a channel"}
                  </small>
                </div>
              </div>
              {selectedMedia[0] ? (
                <div className="preview-image">
                  <MediaPreview media={selectedMedia[0]} />
                </div>
              ) : (
                <div className="preview-placeholder">
                  <ImagePlus size={33} />
                  <span>Your media will appear here</span>
                </div>
              )}
              <p className="preview-caption">
                {input.caption ||
                  "Your next great post starts with a few words…"}
              </p>
              {selectedMedia.length > 1 && (
                <small className="subtle">
                  {selectedMedia.length} media items attached
                </small>
              )}
            </div>
          </section>
          <div className="composer-tip">
            <CalendarClock size={18} />
            <p>
              Choose a time that works for your audience. Your calendar uses{" "}
              <strong>{project.timeZone}</strong>.
            </p>
          </div>
        </aside>
      </div>
      <div className="compose-action-bar">
        <div>
          <span className={`save-dot ${dirty ? "unsaved" : ""}`} />
          {dirty ? "Unsaved changes" : postId ? "Draft saved" : "New draft"}
          <small>
            {input.targets.length} destination
            {input.targets.length === 1 ? "" : "s"}
          </small>
        </div>
        <div className="actions">
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => submitSave("draft")}
          >
            <Save />
            {saving ? "Saving…" : "Save draft"}
          </Button>
          <Button
            variant="outline"
            disabled={saving || !input.targets.length}
            onClick={() => setConfirmation("publish")}
          >
            <Send />
            Publish now
          </Button>
          <Button
            disabled={saving || !input.targets.length}
            onClick={() => setConfirmation("schedule")}
          >
            <CalendarClock />
            Schedule post
          </Button>
        </div>
      </div>
      {picker && (
        <Modal
          title="Choose media"
          description="Media is available only from this project. Select items in publishing order."
          onClose={() => setPicker(false)}
        >
          <div className="media-picker">
            {media.map((m) => (
              <button
                key={m.id}
                className={input.mediaIds.includes(m.id) ? "selected" : ""}
                onClick={() =>
                  setInput({
                    ...input,
                    mediaIds: input.mediaIds.includes(m.id)
                      ? input.mediaIds.filter((id) => id !== m.id)
                      : [...input.mediaIds, m.id],
                  })
                }
              >
                {m.mime.startsWith("image/") ? (
                  <img
                    src={`/api/projects/${project.id}/media/${m.id}/file`}
                    alt={m.name}
                  />
                ) : (
                  <span className="video-choice">Video</span>
                )}
                <span>{m.name}</span>
                {input.mediaIds.includes(m.id) && (
                  <b>{input.mediaIds.indexOf(m.id) + 1}</b>
                )}
              </button>
            ))}
          </div>
          {!media.length && <p>Upload media to get started.</p>}
          <Button onClick={() => setPicker(false)}>Use selected media</Button>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={
            confirmation === "schedule"
              ? "Schedule your post"
              : "Publish this post now?"
          }
          description={`Publish to ${input.targets.length} selected account${input.targets.length === 1 ? "" : "s"} in ${project.name}.`}
          onClose={() => {
            if (!saving) setConfirmation(null);
          }}
        >
          <div className="form-stack">
            {confirmation === "schedule" && (
              <label>
                Publishing time · {project.timeZone}
                <Input
                  type="datetime-local"
                  value={time}
                  required
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
            )}
            {validation.length > 0 && (
              <ErrorMessage error={new Error(validation.join(" "))} />
            )}
            <ErrorMessage error={saveError} />
            <Button
              disabled={saving || validation.length > 0}
              onClick={() => submitSave(confirmation)}
            >
              {saving
                ? "Saving…"
                : confirmation === "schedule"
                  ? "Confirm schedule"
                  : "Publish now"}
            </Button>
          </div>
        </Modal>
      )}
      {blocker.state === "blocked" && (
        <Modal
          title="Leave unsaved changes?"
          description="Your latest edits have not been saved."
          onClose={() => blocker.reset()}
        >
          <div className="actions">
            <Button variant="outline" onClick={() => blocker.reset()}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={() => blocker.proceed()}>
              Discard changes
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function TargetEditor({
  account,
  target,
  onChange,
}: {
  account: Account;
  target: TargetInput;
  onChange: (changes: Partial<TargetInput>) => void;
}) {
  const project = useProject();
  const boards = useDialogLoader<z.infer<typeof boardsSchema>>(
    account.platform === "pinterest"
      ? `/projects/${project.id}/resources/accounts/${account.id}/boards`
      : null,
  );
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>
          <PlatformIcon platform={account.platform} small />
          {account.name}
        </h2>
        <span className="subtle">{platformNames[account.platform]}</span>
      </div>
      <div className="panel-body form-stack">
        <div className="form-row">
          <label>
            Post format
            <select
              value={target.format}
              onChange={(e) =>
                onChange({ format: formatSchema.parse(e.target.value) })
              }
            >
              {account.capabilities.map((format) => (
                <option key={format} value={format}>
                  {format === "short"
                    ? "Shorts-compatible video"
                    : format === "pin"
                      ? "Image Pin"
                      : format[0]?.toUpperCase() + format.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {account.platform === "youtube" ? "Video title" : "Title override"}
            <Input
              value={target.title}
              placeholder="Use post title"
              onChange={(e) => onChange({ title: e.target.value })}
              maxLength={100}
            />
          </label>
        </div>
        <label>
          Caption override
          <Textarea
            value={target.caption}
            placeholder="Use the shared caption"
            onChange={(e) => onChange({ caption: e.target.value })}
          />
        </label>
        {account.platform === "pinterest" && (
          <>
            <label>
              Pinterest board
              <select
                value={target.boardId}
                onChange={(e) => onChange({ boardId: e.target.value })}
              >
                <option value="">Select a board</option>
                {boards.data?.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                  </option>
                ))}
              </select>
            </label>
            <ErrorMessage error={boards.error} />
            {boards.error && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void boards.refetch()}
              >
                Reload boards
              </Button>
            )}
          </>
        )}
        {["facebook", "pinterest"].includes(account.platform) && (
          <label>
            Destination link
            <Input
              type="url"
              placeholder="https://…"
              value={target.link}
              onChange={(e) => onChange({ link: e.target.value })}
            />
          </label>
        )}
        {account.platform === "youtube" && (
          <>
            <label>
              Visibility
              <select
                value={target.privacy}
                onChange={(e) =>
                  onChange({
                    privacy: z
                      .enum(["public", "unlisted", "private"])
                      .parse(e.target.value),
                  })
                }
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={target.madeForKids}
                onChange={(e) => onChange({ madeForKids: e.target.checked })}
              />
              This video is made for kids
            </label>
            <p className="help-text">
              Shorts classification is determined by YouTube from the uploaded
              video. This app does not crop or edit your media.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
