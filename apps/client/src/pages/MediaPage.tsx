import { useRef } from "react";
import { useLoaderData } from "react-router";
import { useRouteMutation } from "@/hooks/use-route-interaction";
import type { mediaLoader } from "@/routes/media";
import { Upload, Trash2, Film } from "lucide-react";
import { type Media } from "@socialsync/shared";
import { useProject } from "@/layouts/ProjectLayout";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorMessage } from "@/components/feedback/Feedback";
export function MediaPreview({ media }: { media: Media }) {
  const url = `/api/projects/${media.projectId}/media/${media.id}/file`;
  return media.mime.startsWith("image/") ? (
    <img src={url} alt={media.name} loading="lazy" />
  ) : (
    <video src={url} preload="metadata" controls>
      <track kind="captions" />
    </video>
  );
}
export function MediaPage() {
  const project = useProject(),
    { media } = useLoaderData<typeof mediaLoader>();
  const input = useRef<HTMLInputElement>(null);
  const upload = useRouteMutation<Media, File>(
    `/projects/${project.id}/media`,
    (file) => {
      const body = new FormData();
      body.set("intent", "upload-media");
      body.set("file", file);
      return body;
    },
  );
  const remove = useRouteMutation<unknown, string>(
    `/projects/${project.id}/media`,
    (mediaId) => ({ intent: "delete-media", mediaId }),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Media</h1>
        </div>
        <Button
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          <Upload />
          {upload.isPending ? "Uploading…" : "Upload media"}
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />
      <ErrorMessage error={upload.error || remove.error} />
      {media.length ? (
        <div className="media-grid">
          {media.map((m) => (
            <article className="panel media-card" key={m.id}>
              <div className="media-preview">
                <MediaPreview media={m} />
              </div>
              <div className="media-card-info">
                <div>
                  <strong title={m.name}>{m.name}</strong>
                  <small>
                    {m.mime.startsWith("video/") ? <Film size={12} /> : null}
                    {(m.size / 1024 / 1024).toFixed(1)} MB
                  </small>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={remove.isPending}
                  aria-label={`Delete ${m.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete ${m.name}?`))
                      remove.mutate(m.id);
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel upload-empty">
          <EmptyState title="No media yet">
            <Button variant="outline" onClick={() => input.current?.click()}>
              <Upload />
              Choose a file
            </Button>
          </EmptyState>
        </div>
      )}
    </>
  );
}
