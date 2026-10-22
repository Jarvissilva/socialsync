import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import { Plus, Search } from "lucide-react";
import { useProject } from "@/layouts/ProjectLayout";
import type { postsLoader } from "@/routes/posts";
import { displayDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlatformIcon } from "@/components/accounts/PlatformIcon";
import { PostDetails, Status } from "@/components/posts/PostDetails";
import { EmptyState } from "@/components/feedback/Feedback";
export function PostsPage() {
  const project = useProject(),
    { posts } = useLoaderData<typeof postsLoader>();
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const filtered = posts.filter(
    (p) =>
      (filter === "all" || p.state === filter) &&
      `${p.title} ${p.caption}`.toLowerCase().includes(search.toLowerCase()),
  );
  const current = posts.find((p) => p.id === selected);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR CONTENT, ORGANIZED</span>
          <h1>Posts</h1>
          <p>Every draft, scheduled idea, and published story in one place.</p>
        </div>
        <Button asChild>
          <Link to={`/projects/${project.id}/compose`}>
            <Plus />
            Create post
          </Link>
        </Button>
      </div>
      <section className="panel">
        <div className="posts-toolbar">
          <div className="filter-tabs">
            {["all", "draft", "scheduled", "published", "needs_attention"].map(
              (value) => (
                <button
                  key={value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {value === "all" ? "All posts" : value.replaceAll("_", " ")}
                </button>
              ),
            )}
          </div>
          <div className="search-field">
            <Search size={15} />
            <Input
              aria-label="Search posts"
              placeholder="Search posts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Channels</th>
                  <th>Publishing time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button
                        className="post-title-button"
                        onClick={() => setSelected(p.id)}
                      >
                        <strong>{p.title || "Untitled post"}</strong>
                        <span>
                          {p.caption.slice(0, 95) || "No shared caption"}
                        </span>
                      </button>
                    </td>
                    <td>
                      <div className="actions">
                        {p.targets.map((t) => (
                          <span key={t.id} title={t.accountName}>
                            <PlatformIcon platform={t.platform} small />
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {p.scheduledAt
                        ? displayDate(p.scheduledAt, project.timeZone)
                        : "Not scheduled"}
                    </td>
                    <td>
                      <Status value={p.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={
              search || filter !== "all"
                ? "No matching posts"
                : "Your next post starts here"
            }
            description={
              search || filter !== "all"
                ? "Try another search or filter."
                : "Create your first draft and give it a place on your calendar."
            }
          >
            <Button variant="outline" asChild>
              <Link to={`/projects/${project.id}/compose`}>
                <Plus />
                Create post
              </Link>
            </Button>
          </EmptyState>
        )}
      </section>
      {current && (
        <PostDetails post={current} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
