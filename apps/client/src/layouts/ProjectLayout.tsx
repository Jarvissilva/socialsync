import { useState } from "react";
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useLoaderData,
  useRouteLoaderData,
  Link,
} from "react-router";
import {
  CalendarDays,
  Files,
  PenLine,
  Image,
  Link2,
  Settings,
  Plus,
  FolderOpen,
  ChevronsUpDown,
  ArrowUpRight,
  Menu,
  X,
  Check,
} from "lucide-react";
import type { Project } from "@social/shared";
import type { rootLoader, projectLoader } from "@/routes/workspace";
import { Brand } from "@/components/layout/Brand";
import { ProjectDialog } from "@/components/projects/ProjectDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
const sections = [
  { path: "", label: "Calendar", icon: CalendarDays },
  { path: "/posts", label: "Posts", icon: Files },
  { path: "/compose", label: "Compose", icon: PenLine },
  { path: "/media", label: "Media library", icon: Image },
  { path: "/accounts", label: "Accounts", icon: Link2 },
  { path: "/settings", label: "Settings", icon: Settings },
];
export function useProject() {
  return useOutletContext<Project>();
}
export function ProjectLayout() {
  const { project } = useLoaderData<typeof projectLoader>();
  const { projects } = useRouteLoaderData<typeof rootLoader>("root")!;
  return (
    <ProjectWorkspace key={project.id} project={project} projects={projects} />
  );
}
function ProjectWorkspace({
  project,
  projects,
}: {
  project: Project;
  projects: Project[];
}) {
  const [creating, setCreating] = useState(false),
    [mobile, setMobile] = useState(false);
  const navigate = useNavigate(),
    location = useLocation(),
    { health } = useRouteLoaderData<typeof projectLoader>("project")!;
  const current =
    sections.find(
      (s) =>
        s.path &&
        location.pathname.startsWith(`/projects/${project.id}${s.path}`),
    )?.path || "";
  return (
    <div className="app-shell">
      <header className="mobile-header">
        <Brand />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle navigation"
          onClick={() => setMobile(!mobile)}
        >
          {mobile ? <X /> : <Menu />}
        </Button>
      </header>
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <Brand />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="project-switch">
              <span className="project-avatar">
                {project.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{project.name}</span>
              <ChevronsUpDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64" align="start">
            <DropdownMenuLabel>Switch project</DropdownMenuLabel>
            {projects.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onSelect={() => navigate(`/projects/${p.id}${current}`)}
              >
                <span className="flex-1">{p.name}</span>
                {p.id === project.id && <Check size={14} />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCreating(true)}>
              <Plus />
              Create project
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/")}>
              <FolderOpen />
              All projects
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Project navigation">
          {sections.map((s) => (
            <NavLink
              end={!s.path}
              key={s.label}
              to={`/projects/${project.id}${s.path}`}
              onClick={() => setMobile(false)}
            >
              <s.icon size={18} />
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link to="/accounts">
            <Link2 size={16} />
            Account library
            <ArrowUpRight size={14} />
          </Link>
          <Link to="/">
            <FolderOpen size={16} />
            All projects
          </Link>
          <div className="worker-indicator">
            <span
              className={health.workerOnline ? "live-dot" : "offline-dot"}
            />
            {health.workerOnline
              ? "Scheduler is running"
              : "Scheduler is offline"}
            <small>{project.timeZone}</small>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-bar">
          <span>
            <FolderOpen size={14} />
            {project.name}
            <span className="breadcrumb-slash">/</span>
            <strong>{sections.find((s) => s.path === current)?.label}</strong>
          </span>
          <span className="local-badge">
            <span className="live-dot" />
            Local workspace
          </span>
        </header>
        <main id="main-content" className="workspace-content">
          <Outlet context={project} />
        </main>
      </div>
      {creating && (
        <ProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            navigate(`/projects/${created.id}`);
          }}
        />
      )}
    </div>
  );
}
