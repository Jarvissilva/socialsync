import { useState } from "react";
import { Tabs } from "radix-ui";
import {
  Link,
  useSearchParams,
  useLoaderData,
  useRouteLoaderData,
} from "react-router";
import {
  useRouteMutation,
  useDialogLoader,
} from "@/hooks/use-route-interaction";
import type { accountsLoader, impactSchema } from "@/routes/accounts";
import type { rootLoader } from "@/routes/workspace";
import { z } from "zod";
import {
  connectionProviders,
  providerNames,
  platformNames,
  platforms,
  type Platform,
  type ProviderApp,
  discoverySchema,
  type Provider,
  type Account,
  type Project,
} from "@socialsync/shared";
import {
  Plus,
  ArrowLeft,
  RefreshCw,
  Unplug,
  FolderPlus,
  Check,
} from "lucide-react";
import { useProject } from "@/layouts/ProjectLayout";
import { Brand } from "@/components/layout/Brand";
import { PlatformIcon } from "@/components/accounts/PlatformIcon";
import { Button } from "@/components/ui/button";
import {
  Modal,
  ErrorMessage,
  Loading,
  EmptyState,
} from "@/components/feedback/Feedback";

export function AccountLibraryPage() {
  return (
    <main id="main-content" className="directory">
      <header className="directory-top">
        <Brand />
        <Button variant="outline" asChild>
          <Link to="/">
            <ArrowLeft />
            All projects
          </Link>
        </Button>
      </header>
      <AccountManager />
    </main>
  );
}
export function ProjectAccountsPage() {
  const project = useProject();
  return <AccountManager project={project} />;
}
function AccountManager({ project }: { project?: Project }) {
  const { accounts: global, projects } =
    useRouteLoaderData<typeof rootLoader>("root")!;
  const { accounts: data } = useLoaderData<typeof accountsLoader>();
  const [connecting, setConnecting] = useState(false),
    [reconnecting, setReconnecting] = useState<Account | null>(null),
    [adding, setAdding] = useState(false),
    [disconnecting, setDisconnecting] = useState<Account | null>(null),
    [assigning, setAssigning] = useState<Account | null>(null);
  const [search, setSearch] = useSearchParams();
  const platform =
    platforms.find((value) => value === search.get("platform")) || "all";
  const visible = data.filter(
    (account) => platform === "all" || account.platform === platform,
  );
  const actionPath = project
    ? `/projects/${project.id}/settings/accounts`
    : "/accounts";
  const connect = useRouteMutation<
    never,
    { platform: Provider; reconnectAccountId?: string; providerAppId?: string }
  >(actionPath, ({ platform, reconnectAccountId, providerAppId }) => ({
    intent: "connect",
    providerAppId: providerAppId || "",
    platform,
    reconnectAccountId: reconnectAccountId || "",
  }));
  const remove = useRouteMutation<unknown, string>(actionPath, (accountId) => ({
    intent: "remove-account",
    accountId,
  }));
  return (
    <>
      <div className="page-heading">
        <div>{project ? <h2>Accounts</h2> : <h1>Accounts</h1>}</div>
        <div className="actions">
          {!project && (
            <Button variant="outline" asChild>
              <Link to="/accounts/config">Accounts config</Link>
            </Button>
          )}
          {project && (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <FolderPlus />
              Add from library
            </Button>
          )}
          <Button onClick={() => setConnecting(true)}>
            <Plus />
            Connect account
          </Button>
        </div>
      </div>
      <ErrorMessage
        error={
          connect.error ||
          remove.error ||
          (search.get("connectionError")
            ? new Error(search.get("connectionError") || "")
            : null)
        }
      />
      <Tabs.Root
        value={platform}
        onValueChange={(value) => {
          const next = new URLSearchParams(search);
          if (value === "all") next.delete("platform");
          else next.set("platform", value);
          setSearch(next, { preventScrollReset: true });
        }}
      >
        <Tabs.List className="section-tabs" aria-label="Account platforms">
          <Tabs.Trigger value="all">
            All accounts <span className="tab-count">{data.length}</span>
          </Tabs.Trigger>
          {platforms.map((value) => (
            <Tabs.Trigger key={value} value={value}>
              <PlatformIcon platform={value} />
              {platformNames[value]}
              <span className="tab-count">
                {data.filter((account) => account.platform === value).length}
              </span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value={platform}>
          {visible.length ? (
            <div className="accounts-grid">
              {visible.map((a) => (
                <article className="panel account-card" key={a.id}>
                  <div className="account-card-heading">
                    <PlatformIcon platform={a.platform} />
                    <span
                      className={`status ${a.status === "connected" ? "published" : "paused"}`}
                    >
                      <span
                        className={
                          a.status === "connected" ? "live-dot" : "offline-dot"
                        }
                      />
                      {a.providerAppId ? a.status : "App setup required"}
                    </span>
                  </div>
                  <h2>{a.name}</h2>
                  <p>
                    {platformNames[a.platform]}
                    {a.username ? ` · ${a.username}` : ""}
                  </p>
                  <div className="account-projects">
                    {a.projectIds.length ? (
                      a.projectIds.map((id) => (
                        <span key={id}>
                          {projects.find((p) => p.id === id)?.name || "Project"}
                        </span>
                      ))
                    ) : (
                      <span>Not added to a project</span>
                    )}
                  </div>
                  <div className="account-card-actions">
                    {project ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(a.id)}
                      >
                        Remove from project
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAssigning(a)}
                      >
                        <FolderPlus />
                        Add to project
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Reconnect ${a.name}`}
                      title="Reconnect"
                      disabled={connect.isPending}
                      onClick={() => setReconnecting(a)}
                    >
                      <RefreshCw />
                    </Button>
                    {!project && a.status !== "disconnected" && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Disconnect ${a.name}`}
                        title="Disconnect"
                        onClick={() => setDisconnecting(a)}
                      >
                        <Unplug />
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="panel">
              <EmptyState
                title={
                  platform === "all"
                    ? project
                      ? "No project accounts"
                      : "No accounts yet"
                    : `No ${platformNames[platform]} accounts`
                }
                description={
                  project
                    ? "Add a connected account from your library, or connect a new one."
                    : undefined
                }
              >
                <Button
                  onClick={() =>
                    project ? setAdding(true) : setConnecting(true)
                  }
                >
                  <Plus />
                  {project ? "Add from library" : "Connect account"}
                </Button>
              </EmptyState>
            </div>
          )}
        </Tabs.Content>
      </Tabs.Root>
      {reconnecting && (
        <ReconnectDialog
          account={reconnecting}
          busy={connect.isPending}
          error={connect.error}
          onClose={() => setReconnecting(null)}
          onConnect={(providerAppId) =>
            connect.mutate({
              providerAppId,
              platform: reconnecting.provider,
              reconnectAccountId: reconnecting.id,
            })
          }
        />
      )}
      {connecting && (
        <ConnectDialog
          platform={platform === "all" ? undefined : platform}
          busy={connect.isPending}
          error={connect.error}
          onConnect={(platform, providerAppId) =>
            connect.mutate({ platform, providerAppId })
          }
          onClose={() => setConnecting(false)}
        />
      )}{" "}
      {adding && project && (
        <AssignmentDialog
          project={project}
          accounts={global}
          onClose={() => setAdding(false)}
        />
      )}{" "}
      {assigning && (
        <AccountAssignmentDialog
          account={assigning}
          projects={projects}
          onClose={() => setAssigning(null)}
        />
      )}{" "}
      {disconnecting && (
        <DisconnectDialog
          account={disconnecting}
          onClose={() => setDisconnecting(null)}
        />
      )}{" "}
      {search.get("discovery") && (
        <DiscoveryDialog
          id={search.get("discovery") || ""}
          onClose={() => {
            search.delete("discovery");
            search.delete("connectionError");
            setSearch(search, { replace: true });
          }}
        />
      )}
    </>
  );
}
function ConnectDialog({
  platform,
  onConnect,
  onClose,
  busy,
  error,
}: {
  platform?: Platform;
  onConnect: (platform: Provider, providerAppId: string) => void;
  onClose: () => void;
  busy: boolean;
  error: unknown;
}) {
  const apps = useDialogLoader<ProviderApp[]>("/resources/provider-apps");
  const providers = platform
    ? [
        platform === "instagram" || platform === "facebook"
          ? ("meta" as const)
          : platform,
      ]
    : connectionProviders;
  return (
    <Modal
      title={
        platform ? `Connect ${platformNames[platform]}` : "Connect account"
      }
      onClose={onClose}
    >
      <div className="form-stack">
        {providers.map((provider) => (
          <ProviderAppChoice
            key={provider}
            provider={provider}
            apps={apps.data || []}
            busy={busy || apps.isPending}
            onConnect={(id) => onConnect(provider, id)}
          />
        ))}
        <Link to="/accounts/config">Accounts config</Link>
        <ErrorMessage error={error || apps.error} />
      </div>
    </Modal>
  );
}
function ProviderAppChoice({
  provider,
  apps,
  busy,
  onConnect,
  explicit = false,
}: {
  provider: Provider;
  apps: ProviderApp[];
  busy: boolean;
  onConnect: (id: string) => void;
  explicit?: boolean;
}) {
  const compatible = apps.filter(
    (app) =>
      app.provider === provider ||
      (provider === "facebook" && app.provider === "meta"),
  );
  const [selected, setSelected] = useState("");
  const id =
    selected || (!explicit && compatible.length === 1 ? compatible[0]!.id : "");
  return (
    <div className="form-stack">
      <label>
        {providerNames[provider]}
        <select
          aria-label={`${providerNames[provider]} account configuration`}
          value={id}
          onChange={(e) => setSelected(e.target.value)}
          disabled={busy || !compatible.length}
        >
          <option value="">
            {compatible.length
              ? "Choose a configuration"
              : "App setup required"}
          </option>
          {compatible.map((app) => (
            <option key={app.id} value={app.id}>
              {app.name} · {app.clientId}
            </option>
          ))}
        </select>
      </label>
      <Button
        variant="outline"
        className="provider-button"
        disabled={busy || !id}
        onClick={() => onConnect(id)}
      >
        <PlatformIcon platform={provider === "meta" ? "facebook" : provider} />
        <span>Connect {providerNames[provider]}</span>
      </Button>
    </div>
  );
}

function AssignmentDialog({
  project,
  accounts,
  onClose,
}: {
  project: Project;
  accounts: Account[];
  onClose: () => void;
}) {
  const mutation = useRouteMutation<unknown, string>(
    `/projects/${project.id}/settings/accounts`,
    (accountId) => ({ intent: "assign", accountId }),
  );
  return (
    <Modal title="Add accounts" onClose={onClose}>
      <div className="form-stack">
        {accounts.length ? (
          accounts.map((a) => {
            const added = a.projectIds.includes(project.id);
            return (
              <div className="account-choice" key={a.id}>
                <PlatformIcon platform={a.platform} />
                <div>
                  <strong>{a.name}</strong>
                  <small>{platformNames[a.platform]}</small>
                </div>
                <Button
                  variant={added ? "ghost" : "outline"}
                  size="sm"
                  disabled={added || mutation.isPending}
                  onClick={() => mutation.mutate(a.id)}
                >
                  {added ? (
                    <>
                      <Check />
                      Added
                    </>
                  ) : (
                    <>
                      <Plus />
                      Add
                    </>
                  )}
                </Button>
              </div>
            );
          })
        ) : (
          <EmptyState
            title="No accounts available"
            description="Connect an account first."
          />
        )}
        <ErrorMessage error={mutation.error} />
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
function AccountAssignmentDialog({
  account,
  projects,
  onClose,
}: {
  account: Account;
  projects: Project[];
  onClose: () => void;
}) {
  const mutation = useRouteMutation<unknown, string>(
    "/accounts",
    (projectId) => ({ intent: "assign", projectId, accountId: account.id }),
    onClose,
  );
  return (
    <Modal title={`Add ${account.name} to a project`} onClose={onClose}>
      <div className="form-stack">
        {projects.length ? (
          projects.map((p) => (
            <Button
              key={p.id}
              variant="outline"
              disabled={account.projectIds.includes(p.id) || mutation.isPending}
              onClick={() => mutation.mutate(p.id)}
            >
              {p.name}
              {account.projectIds.includes(p.id) ? <Check /> : <Plus />}
            </Button>
          ))
        ) : (
          <p>Create a project first.</p>
        )}
        <ErrorMessage error={mutation.error} />
      </div>
    </Modal>
  );
}
function ReconnectDialog({
  account,
  busy,
  error,
  onConnect,
  onClose,
}: {
  account: Account;
  busy: boolean;
  error: unknown;
  onConnect: (id?: string) => void;
  onClose: () => void;
}) {
  const impact = useDialogLoader<z.infer<typeof impactSchema>>(
    `/resources/accounts/${account.id}/impact`,
  );
  const apps = useDialogLoader<ProviderApp[]>("/resources/provider-apps");
  return (
    <Modal
      title={`Reconnect ${account.name}?`}
      description="Replaces access for all accounts sharing this authorization. Publishing history is preserved."
      onClose={onClose}
    >
      <div className="form-stack">
        {impact.isPending ? (
          <Loading />
        ) : (
          <>
            <p>
              Affected accounts:{" "}
              {impact.data?.accounts.map((a) => a.name).join(", ")}
            </p>
            <p>
              Affected projects:{" "}
              {impact.data?.projects.map((p) => p.name).join(", ") || "None"}
            </p>
            <p>Keep access to all these destinations when signing in again.</p>
          </>
        )}
        <ErrorMessage error={impact.error || error} />
        {account.providerAppId ? (
          <>
            <p>
              Account configuration:{" "}
              {apps.data?.find((app) => app.id === account.providerAppId)
                ?.name || "Saved configuration"}
            </p>
            <Button disabled={busy || !impact.data} onClick={() => onConnect()}>
              Continue to sign in
            </Button>
          </>
        ) : (
          <>
            <p>
              App setup required. Select the developer app that authorized this
              account.
            </p>
            <ProviderAppChoice
              provider={account.provider}
              apps={apps.data || []}
              busy={busy || !impact.data || apps.isPending}
              explicit
              onConnect={onConnect}
            />
            <Link to="/accounts/config">Accounts config</Link>
          </>
        )}
        <ErrorMessage error={apps.error} />
      </div>
    </Modal>
  );
}
function DisconnectDialog({
  account,
  onClose,
}: {
  account: Account;
  onClose: () => void;
}) {
  const impact = useDialogLoader<z.infer<typeof impactSchema>>(
    `/resources/accounts/${account.id}/impact`,
  );
  const mutation = useRouteMutation<unknown>(
    "/accounts",
    () => ({ intent: "disconnect", accountId: account.id, confirmed: "true" }),
    onClose,
  );
  return (
    <Modal
      title={`Disconnect ${account.name}?`}
      description="This removes the shared authorization and pauses pending posts. Publishing history is preserved."
      onClose={onClose}
    >
      {impact.isPending ? (
        <Loading />
      ) : (
        <div className="form-stack">
          <p>
            Affected accounts:{" "}
            {impact.data?.accounts.map((a) => a.name).join(", ")}
          </p>
          <p>
            Affected projects:{" "}
            {impact.data?.projects.map((p) => p.name).join(", ") || "None"}
          </p>
          <p>
            {impact.data?.pendingCount || 0} pending destinations may be
            affected.
          </p>
          <ErrorMessage error={impact.error || mutation.error} />
          <Button
            variant="destructive"
            disabled={mutation.isPending || !impact.data}
            onClick={() => mutation.mutate()}
          >
            Disconnect shared authorization
          </Button>
        </div>
      )}
    </Modal>
  );
}
function DiscoveryDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const discovery = useDialogLoader<z.infer<typeof discoverySchema>>(
    `/resources/discoveries/${id}`,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const save = useRouteMutation<unknown>(
    "/accounts",
    () => ({
      intent: "save-discovery",
      discoveryId: id,
      externalIds: selected,
    }),
    onClose,
  );
  return (
    <Modal
      title="Choose your accounts"
      description="Select accounts to save."
      onClose={onClose}
    >
      {discovery.isPending ? (
        <Loading />
      ) : (
        <div className="form-stack">
          {discovery.data?.candidates.map((a) => (
            <label className="account-choice" key={a.externalId}>
              <input
                type="checkbox"
                checked={selected.includes(a.externalId)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, a.externalId]
                      : selected.filter((id) => id !== a.externalId),
                  )
                }
              />
              <div>
                <strong>{a.name}</strong>
                <small>
                  {platformNames[a.platform]} · {a.username || a.externalId}
                </small>
              </div>
            </label>
          ))}
          <ErrorMessage error={discovery.error || save.error} />
          <Button
            disabled={!selected.length || save.isPending}
            onClick={() => save.mutate()}
          >
            Add selected accounts
          </Button>
        </div>
      )}
    </Modal>
  );
}
