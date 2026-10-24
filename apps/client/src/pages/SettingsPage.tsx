import { useState } from "react";
import { NavLink, Outlet, useFetcher, useRouteLoaderData } from "react-router";
import type { settingsLoader, workspaceAction } from "@/routes/workspace";
import { Save, Check } from "lucide-react";
import { useProject } from "@/layouts/ProjectLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorMessage } from "@/components/feedback/Feedback";
export function SettingsPage() {
  const project = useProject();
  return (
    <>
      <div className="page-heading">
        <h1>Settings</h1>
      </div>
      <nav className="section-tabs" aria-label="Project settings">
        <NavLink to={`/projects/${project.id}/settings`} end>
          General
        </NavLink>
        <NavLink to={`/projects/${project.id}/settings/accounts`}>
          Accounts
        </NavLink>
      </nav>
      <Outlet context={project} />
    </>
  );
}
export function GeneralSettingsPage() {
  const project = useProject(),
    { health } = useRouteLoaderData<typeof settingsLoader>("settings")!;
  const [name, setName] = useState(project.name),
    [timeZone, setTimeZone] = useState(project.timeZone);
  const save = useFetcher<typeof workspaceAction>();
  return (
    <>
      <div className="settings-grid">
        <section className="panel settings-panel">
          <h2>General</h2>
          <save.Form
            className="form-stack"
            method="post"
            action={`/projects/${project.id}/settings`}
          >
            <input type="hidden" name="intent" value="save-settings" />
            <label>
              Project name
              <Input
                required
                name="name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Publishing time zone
              <Input
                required
                name="timeZone"
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
              />
              <span className="help-text">
                IANA zone, e.g. Asia/Kolkata. Existing scheduled times stay
                unchanged.
              </span>
            </label>
            <ErrorMessage
              error={save.data?.ok === false ? save.data.error : undefined}
            />
            <div className="actions">
              <Button disabled={save.state !== "idle"}>
                <Save />
                {save.state !== "idle" ? "Saving…" : "Save changes"}
              </Button>
              {save.state === "idle" && save.data?.ok && (
                <span className="success-text">
                  <Check size={14} />
                  Saved
                </span>
              )}
            </div>
          </save.Form>
        </section>
        <section className="panel settings-panel">
          <h2>Publishing readiness</h2>
          <div className="readiness-row">
            <span>Background scheduler</span>
            <span
              className={`status ${health.workerOnline ? "published" : "paused"}`}
            >
              {health.workerOnline ? "Running" : "Offline"}
            </span>
          </div>
          <div className="readiness-row">
            <span>Media delivery</span>
            <span
              className={`status ${health.publicMediaReady ? "published" : "paused"}`}
            >
              {health.publicMediaReady ? "Configured" : "Setup needed"}
            </span>
          </div>
          <p className="help-text">
            Keep this computer awake and connected for scheduled publishing.
            Media delivery requires private R2 or an HTTPS tunnel. Configured
            delivery may still be unreachable.
          </p>
        </section>
      </div>
    </>
  );
}
