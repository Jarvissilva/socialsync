import { useState } from "react";
import { Link, useRouteLoaderData, useNavigate } from "react-router";
import { Plus, ArrowUpRight, FolderOpen, Link2 } from "lucide-react";
import type { rootLoader } from "@/routes/workspace";
import { Brand } from "@/components/layout/Brand";
import { ProjectDialog } from "@/components/projects/ProjectDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
export function HomePage() {
  const { projects } = useRouteLoaderData<typeof rootLoader>("root")!;
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  return (
    <main id="main-content" className="directory">
      <header className="directory-top">
        <Brand />
        <Button variant="outline" asChild>
          <Link to="/accounts">
            <Link2 />
            Accounts
            <ArrowUpRight />
          </Link>
        </Button>
      </header>
      <div className="page-heading">
        <div>
          <h1>
            Projects <span className="count">{projects.length}</span>
          </h1>
        </div>
      </div>
      <div className="project-grid">
        {projects.map((p) => (
          <Link
            key={p.id}
            to={`/projects/${p.id}`}
            className="project-card-link"
          >
            <Card className="project-card gap-0 rounded-lg pt-4 pb-0 shadow-none">
              <CardContent className="px-4">
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
                  <span>{p.scheduledCount} scheduled</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        <button
          type="button"
          className="project-card project-create-card"
          onClick={() => setCreating(true)}
        >
          <span className="project-folder">
            <Plus size={24} />
          </span>
          <span className="project-create-title">New project</span>
          <span className="help-text">
            {projects.length
              ? "Create another workspace"
              : "Create your first workspace"}
          </span>
        </button>
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
