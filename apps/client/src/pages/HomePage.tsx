import { useState } from "react";
import { Link, useRouteLoaderData, useNavigate } from "react-router";
import {
  Plus,
  ArrowUpRight,
  FolderOpen,
  Link2,
  ArrowRight,
} from "lucide-react";
import type { rootLoader } from "@/routes/workspace";
import { Brand } from "@/components/layout/Brand";
import { ProjectDialog } from "@/components/projects/ProjectDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/feedback/Feedback";
export function HomePage() {
  const { projects, accounts } = useRouteLoaderData<typeof rootLoader>("root")!;
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  return (
    <main id="main-content" className="directory">
      <header className="directory-top">
        <Brand />
        <Button variant="outline" asChild>
          <Link to="/accounts">
            <Link2 />
            Account library
            <ArrowUpRight />
          </Link>
        </Button>
      </header>
      <section className="directory-intro">
        <span className="eyebrow">YOUR PUBLISHING WORKSPACE</span>
        <h1>A home for every brand.</h1>
        <p>Keep your projects separate. Bring your social accounts together.</p>
      </section>
      <div className="page-heading">
        <div>
          <h2>
            Your projects <span className="count">{projects.length}</span>
          </h2>
          <p>Pick a project to plan your next great post.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          New project
        </Button>
      </div>
      {projects.length ? (
        <div className="project-grid">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="project-card-link"
            >
              <Card className="project-card">
                <CardContent>
                  <div className="project-card-top">
                    <span className="project-folder">
                      <FolderOpen size={24} />
                    </span>
                    <ArrowUpRight size={18} />
                  </div>
                  <h2>{p.name}</h2>
                  <p>{p.timeZone}</p>
                  <div className="project-card-footer">
                    <span>{p.accountCount} accounts</span>
                    <span>
                      {p.scheduledCount} scheduled
                      <ArrowRight size={14} />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          <button
            className="new-project-card"
            onClick={() => setCreating(true)}
          >
            <Plus size={23} />
            <strong>Create a project</strong>
            <span>A fresh space for your next idea</span>
          </button>
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            title="Your first project starts here"
            description="Create a project for a brand, business, or personal channel. Add accounts whenever you’re ready."
          >
            <Button onClick={() => setCreating(true)}>
              <Plus />
              Create project
            </Button>
          </EmptyState>
        </div>
      )}
      <div className="directory-note">
        <Link2 size={19} />
        <div>
          <strong>Connect once. Use across projects.</strong>
          <p>
            {accounts.length} accounts in your library. Your content and
            calendars always stay separate.
          </p>
        </div>
        <Link to="/accounts">
          Manage accounts <ArrowRight size={14} />
        </Link>
      </div>
      {creating && (
        <ProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(project) => navigate(`/projects/${project.id}`)}
        />
      )}
    </main>
  );
}
