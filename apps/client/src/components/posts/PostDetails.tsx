import { useState } from "react";
import { Link } from "react-router";
import { useRouteMutation } from "@/hooks/use-route-interaction";
import {
  Copy,
  ExternalLink,
  RefreshCw,
  CalendarClock,
  PenLine,
} from "lucide-react";
import { platformNames, type Post } from "@social/shared";
import { useProject } from "@/layouts/ProjectLayout";
import { displayDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ErrorMessage } from "@/components/feedback/Feedback";
import { PlatformIcon } from "@/components/accounts/PlatformIcon";
export function Status({ value }: { value: string }) {
  return (
    <span className={`status ${value}`}>{value.replaceAll("_", " ")}</span>
  );
}
export function PostDetails({
  post,
  onClose,
}: {
  post: Post;
  onClose: () => void;
}) {
  const project = useProject();
  const [resolving, setResolving] = useState<string | null>(null),
    [remoteId, setRemoteId] = useState(""),
    [verified, setVerified] = useState(false);
  const action = useRouteMutation<
    Post,
    {
      type: "cancel" | "duplicate" | "retry" | "published" | "not_published";
      jobId?: string;
    }
  >(
    `/projects/${project.id}/posts`,
    ({ type, jobId }) => ({
      intent: type,
      postId: post.id,
      jobId: jobId || "",
      verified: String(verified),
      remoteId,
    }),
    (_result, args) => {
      setResolving(null);
      if (args.type === "duplicate") onClose();
    },
  );
  return (
    <Modal
      title={post.title || "Untitled post"}
      description={
        post.scheduledAt
          ? `${displayDate(post.scheduledAt, project.timeZone)} · ${project.timeZone}`
          : "Unscheduled draft"
      }
      onClose={onClose}
    >
      <div className="form-stack">
        <div className="actions">
          <Status value={post.state} />
          {["draft", "scheduled", "cancelled"].includes(post.state) && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/projects/${project.id}/compose/${post.id}`}>
                <PenLine />
                Edit
              </Link>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={action.isPending}
            onClick={() => action.mutate({ type: "duplicate" })}
          >
            <Copy />
            Duplicate
          </Button>
        </div>
        <p className="post-detail-caption">
          {post.caption || "No shared caption."}
        </p>
        {post.targets.map((target) => (
          <div className="destination-row" key={target.id}>
            <div className="destination-heading">
              <PlatformIcon platform={target.platform} small />
              <strong>{target.accountName}</strong>
              <Status value={post.scheduledAt ? target.status : "draft"} />
            </div>
            <small>
              {platformNames[target.platform]} · {target.format} ·{" "}
              {target.attempts} attempts
            </small>
            {target.error && <ErrorMessage error={new Error(target.error)} />}
            <div className="actions">
              {target.url && (
                <Button variant="outline" size="sm" asChild>
                  <a href={target.url} target="_blank" rel="noreferrer">
                    <ExternalLink />
                    View post
                  </a>
                </Button>
              )}
              {["failed", "paused"].includes(target.status) ||
              (target.status === "needs_attention" &&
                target.error === "Missed while the worker was offline.") ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ type: "retry", jobId: target.id })
                  }
                >
                  <RefreshCw />
                  Publish / resume now
                </Button>
              ) : target.status === "needs_attention" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setResolving(target.id);
                    setVerified(false);
                    setRemoteId("");
                  }}
                >
                  Resolve outcome
                </Button>
              ) : null}
            </div>
            {resolving === target.id && (
              <div className="resolution-box form-stack">
                <p>
                  Check this account on the platform before recording the
                  outcome.
                </p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={verified}
                    onChange={(e) => setVerified(e.target.checked)}
                  />
                  I checked the destination account.
                </label>
                <label>
                  Published post ID, if it exists
                  <Input
                    value={remoteId}
                    onChange={(e) => setRemoteId(e.target.value)}
                    placeholder="Platform post or video ID"
                  />
                </label>
                <div className="actions">
                  <Button
                    size="sm"
                    disabled={!verified || !remoteId.trim() || action.isPending}
                    onClick={() =>
                      action.mutate({ type: "published", jobId: target.id })
                    }
                  >
                    Record as published
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!verified || action.isPending}
                    onClick={() =>
                      action.mutate({ type: "not_published", jobId: target.id })
                    }
                  >
                    Confirm not published
                  </Button>
                </div>
                <p className="help-text">
                  Confirming it was not published enables an explicit retry. It
                  does not publish automatically.
                </p>
              </div>
            )}
          </div>
        ))}
        <ErrorMessage error={action.error} />
        {[
          "scheduled",
          "processing",
          "paused",
          "failed",
          "partial",
          "needs_attention",
        ].includes(post.state) && (
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => action.mutate({ type: "cancel" })}
          >
            <CalendarClock />
            Cancel remaining scheduled destinations
          </Button>
        )}
        {post.state === "processing" && (
          <p className="help-text">
            Already uploaded or in-flight destinations continue to report their
            outcome.
          </p>
        )}
      </div>
    </Modal>
  );
}
