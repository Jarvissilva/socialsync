import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CheckCircle2,
  PenLine,
  Clock3,
} from "lucide-react";
import { useProject } from "@/layouts/ProjectLayout";
import type { postsLoader } from "@/routes/posts";
import { dayKey } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "@/components/accounts/PlatformIcon";
import { PostDetails } from "@/components/posts/PostDetails";
export function CalendarPage() {
  const project = useProject(),
    { posts } = useLoaderData<typeof postsLoader>();
  const today = dayKey(new Date(), project.timeZone);
  const [month, setMonth] = useState(() => today.slice(0, 7)),
    [selected, setSelected] = useState<string | null>(null);
  const [year = 2026, monthNum = 1] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNum - 1, 1)),
    start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    return date;
  });
  const data = posts;
  const current = data.find((p) => p.id === selected);
  const move = (delta: number) =>
    setMonth(
      new Date(Date.UTC(year, monthNum - 1 + delta, 1))
        .toISOString()
        .slice(0, 7),
    );
  const stats = [
    {
      label: "Scheduled",
      value: data.filter(
        (p) => p.state === "scheduled" || p.state === "processing",
      ).length,
      icon: CalendarDays,
    },
    {
      label: "Published",
      value: data.filter((p) => p.state === "published").length,
      icon: CheckCircle2,
    },
    {
      label: "Drafts",
      value: data.filter((p) => p.state === "draft").length,
      icon: PenLine,
    },
    {
      label: "Needs attention",
      value: data.filter((p) =>
        ["needs_attention", "failed", "paused", "partial"].includes(p.state),
      ).length,
      icon: Clock3,
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Calendar</h1>
        </div>
        <Button asChild>
          <Link to={`/projects/${project.id}/compose`}>
            <Plus />
            Create post
          </Link>
        </Button>
      </div>
      <div className="stats-grid">
        {stats.map((s) => (
          <div className="stat-card" key={s.label}>
            <div>
              <span>{s.label}</span>
              <s.icon size={17} />
            </div>
            <strong>{s.value}</strong>
          </div>
        ))}
      </div>
      <section className="panel calendar-panel">
        <div className="calendar-toolbar">
          <div className="actions">
            <h2>
              {new Intl.DateTimeFormat("en", {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              }).format(first)}
            </h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous month"
              onClick={() => move(-1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next month"
              onClick={() => move(1)}
            >
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMonth(today.slice(0, 7))}
            >
              Today
            </Button>
          </div>
          <span className="calendar-timezone">{project.timeZone}</span>
        </div>
        <div className="calendar-scroll">
          <div className="calendar-grid">
            {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => (
              <div className="calendar-weekday" key={day}>
                {day}
              </div>
            ))}
            {days.map((date) => {
              const key = date.toISOString().slice(0, 10),
                items = data.filter(
                  (p) =>
                    p.scheduledAt &&
                    dayKey(new Date(p.scheduledAt), project.timeZone) === key,
                );
              return (
                <div
                  key={key}
                  className={`calendar-day ${key.slice(0, 7) !== month ? "outside" : ""} ${key === today ? "today" : ""}`}
                >
                  <div className="day-number">
                    <span>{date.getUTCDate()}</span>
                    <Link
                      aria-label={`Create post for ${key}`}
                      to={`/projects/${project.id}/compose?date=${key}`}
                    >
                      <Plus size={13} />
                    </Link>
                  </div>
                  <div className="calendar-items">
                    {items.map((p) => (
                      <button
                        key={p.id}
                        className={`calendar-post ${p.state}`}
                        onClick={() => setSelected(p.id)}
                      >
                        <div>
                          {p.targets.slice(0, 3).map((t) => (
                            <PlatformIcon
                              key={t.id}
                              platform={t.platform}
                              small
                            />
                          ))}
                          <time>
                            {new Intl.DateTimeFormat("en", {
                              timeZone: project.timeZone,
                              hour: "numeric",
                              minute: "2-digit",
                            }).format(new Date(p.scheduledAt || ""))}
                          </time>
                        </div>
                        <strong>
                          {p.title || p.caption.slice(0, 45) || "Untitled post"}
                        </strong>
                        <small>{p.state.replaceAll("_", " ")}</small>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <footer className="calendar-footer">
          <span>
            <i className="legend-dot scheduled" />
            Scheduled
          </span>
          <span>
            <i className="legend-dot published" />
            Published
          </span>
          <span>
            <i className="legend-dot needs_attention" />
            Needs attention
          </span>
          <Link to={`/projects/${project.id}/posts`}>View all posts →</Link>
        </footer>
      </section>
      {!data.length && (
        <p className="calendar-empty-note">
          No posts yet.{" "}
          <Link to={`/projects/${project.id}/compose`}>
            Create your first post
          </Link>
        </p>
      )}
      {current && (
        <PostDetails post={current} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
