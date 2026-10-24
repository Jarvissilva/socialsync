import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import { ArrowLeft, Plus } from "lucide-react";
import {
  connectionProviders,
  providerNames,
  type ProviderApp,
} from "@socialsync/shared";
import type { providerAppsLoader } from "@/routes/provider-apps";
import { useRouteMutation } from "@/hooks/use-route-interaction";
import { Brand } from "@/components/layout/Brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Modal,
  ErrorMessage,
  EmptyState,
} from "@/components/feedback/Feedback";

export function ProviderAppsPage() {
  const { apps } = useLoaderData<typeof providerAppsLoader>();
  const providers = [
    ...new Set<ProviderApp["provider"]>([
      ...connectionProviders,
      ...apps.map((app) => app.provider),
    ]),
  ];
  const [editing, setEditing] = useState<ProviderApp | "new" | null>(null);
  const [newProvider, setNewProvider] = useState<string>("meta");
  const [deleting, setDeleting] = useState<ProviderApp | null>(null);
  return (
    <main id="main-content" className="directory">
      <header className="directory-top">
        <Brand />
        <Button variant="outline" asChild>
          <Link to="/accounts">
            <ArrowLeft />
            Accounts
          </Link>
        </Button>
      </header>
      <div className="page-heading">
        <div>
          <h1>Accounts config</h1>
        </div>
      </div>
      {providers.map((provider) => {
        const configurations = apps.filter((app) => app.provider === provider);
        return (
          <section
            className="config-provider-group"
            key={provider}
            aria-labelledby={`provider-${provider}`}
          >
            <div className="page-heading">
              <h2 id={`provider-${provider}`}>
                {providerNames[provider]}{" "}
                <span className="count">{configurations.length}</span>
              </h2>
              {connectionProviders.some((value) => value === provider) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setNewProvider(provider);
                    setEditing("new");
                  }}
                  aria-label={`Add ${providerNames[provider]} configuration`}
                >
                  <Plus /> Add configuration
                </Button>
              )}
            </div>
            {configurations.length ? (
              <div className="accounts-grid">
                {configurations.map((app) => (
                  <article
                    className="panel account-card provider-app-card"
                    key={app.id}
                  >
                    <h3>{app.name}</h3>
                    <p>Client ID: {app.clientId}</p>
                    <p>{app.linkedAccountCount} linked accounts</p>
                    <div className="account-card-actions">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(app)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(app)}
                      >
                        Delete
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="panel">
                <EmptyState
                  title="No configurations yet"
                  description={`Add a ${providerNames[provider]} app configuration to connect accounts.`}
                />
              </div>
            )}
          </section>
        );
      })}
      {editing && (
        <ProviderAppDialog
          app={editing === "new" ? undefined : editing}
          initialProvider={newProvider}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteProviderAppDialog
          app={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </main>
  );
}
function ProviderAppDialog({
  app,
  initialProvider,
  onClose,
}: {
  app?: ProviderApp;
  initialProvider: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(app?.name || ""),
    [provider, setProvider] = useState(initialProvider),
    [clientId, setClientId] = useState(""),
    [secret, setSecret] = useState("");
  const save = useRouteMutation<ProviderApp>(
    "/accounts/config",
    (): Record<string, string> =>
      app
        ? { intent: "update", id: app.id, name, clientSecret: secret }
        : { intent: "create", name, provider, clientId, clientSecret: secret },
    onClose,
  );
  return (
    <Modal
      title={app ? `Edit ${app.name}` : "Add configuration"}
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Name
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
          />
        </label>
        {app ? (
          <>
            <p>
              {providerNames[app.provider]} · Client ID: {app.clientId}
            </p>
            <p className="help-text">
              To use a different provider or client ID, create a new
              configuration.
            </p>
            <div>
              <p className="help-text">Callback URL</p>
              <code className="provider-app-callback">{app.callbackUrl}</code>
            </div>
          </>
        ) : (
          <>
            <label>
              Provider
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {connectionProviders.map((p) => (
                  <option key={p} value={p}>
                    {providerNames[p]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Client ID
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                maxLength={500}
                required
                autoComplete="off"
              />
            </label>
          </>
        )}
        <label>
          {app ? "Replacement client secret" : "Client secret"}
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            maxLength={4000}
            required={!app}
            autoComplete="new-password"
            placeholder={app ? "Leave empty to keep saved secret" : ""}
          />
        </label>
        {app && (
          <p className="help-text">
            Finish active connections and publishing before replacing a secret.
          </p>
        )}
        <ErrorMessage error={save.error} />
        <Button disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save configuration"}
        </Button>
      </form>
    </Modal>
  );
}
function DeleteProviderAppDialog({
  app,
  onClose,
}: {
  app: ProviderApp;
  onClose: () => void;
}) {
  const remove = useRouteMutation<unknown>(
    "/accounts/config",
    () => ({ intent: "delete", id: app.id }),
    onClose,
  );
  return (
    <Modal
      title={`Delete ${app.name}?`}
      description="Disconnect linked accounts and finish active connections before deleting."
      onClose={onClose}
    >
      <div className="form-stack">
        <p>{app.linkedAccountCount} linked accounts</p>
        <ErrorMessage error={remove.error} />
        <Button
          variant="destructive"
          disabled={remove.isPending || app.linkedAccountCount > 0}
          onClick={() => remove.mutate()}
        >
          Delete configuration
        </Button>
      </div>
    </Modal>
  );
}
