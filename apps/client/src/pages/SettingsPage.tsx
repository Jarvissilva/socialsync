import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import type { settingsLoader, workspaceAction } from "@/routes/workspace";
import { Save, Check } from "lucide-react";
import { useProject } from "@/layouts/ProjectLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorMessage } from "@/components/feedback/Feedback";
export function SettingsPage() {
  const project = useProject(),
    { health } = useLoaderData<typeof settingsLoader>();
  const [name, setName] = useState(project.name),
    [timeZone, setTimeZone] = useState(project.timeZone);
  const save = useFetcher<typeof workspaceAction>();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h1>Project settings</h1>
          <p>Manage this project’s name and publishing time zone.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel settings-panel">
          <h2>General</h2>
          <p>Changes apply only to this project.</p>
          <save.Form className="form-stack" method="post">
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
                Use an IANA zone, such as Asia/Kolkata or Europe/London.
                Existing scheduled instants stay unchanged.
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
            <span>Public media delivery</span>
            <span
              className={`status ${health.publicMediaReady ? "published" : "paused"}`}
            >
              {health.publicMediaReady ? "Configured" : "Setup needed"}
            </span>
          </div>
          <p className="help-text">
            Keep your computer awake and connected to publish on time. Configure
            your HTTPS tunnel in the server environment for platforms that fetch
            uploaded media.
          </p>
        </section>
      </div>
    </>
  );
}
