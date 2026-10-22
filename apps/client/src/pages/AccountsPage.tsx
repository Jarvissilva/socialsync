import { useState } from "react";
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
  providerStatusSchema,
  discoverySchema,
  type Provider,
  type Account,
  type Project,
} from "@social/shared";
import {
  Plus,
  ArrowLeft,
  Link2,
  RefreshCw,
  Unplug,
  FolderPlus,
  Check,
  ArrowUpRight,
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
  const actionPath = project ? `/projects/${project.id}/accounts` : "/accounts";
  const connect = useRouteMutation<
    never,
    { platform: Provider; reconnectAccountId?: string }
  >(actionPath, ({ platform, reconnectAccountId }) => ({
    intent: "connect",
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
        <div>
          <span className="eyebrow">
            {project ? "PROJECT CONNECTIONS" : "CONNECTED CHANNELS"}
          </span>
          <h1>{project ? "Accounts" : "Account library"}</h1>
          <p>
            {project
              ? "Choose which social accounts this project can publish to."
              : "Connect your social accounts once. Add them to any project."}
          </p>
        </div>
        <div className="actions">
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
      <div className="info-strip">
        <Link2 size={17} />
        <p>
          {project
            ? "Account access is shared. This project’s posts, media, and calendar are separate."
            : "Reconnecting an account updates access for every project using it."}
        </p>
        {project && (
          <Link to="/accounts">
            Account library
            <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
      {data.length ? (
        <div className="accounts-grid">
          {data.map((a) => (
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
                  {a.status}
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
              project
                ? "Bring your channels into this project"
                : "Your channels, all in one place"
            }
            description={
              project
                ? "Add a connected account from your library, or connect a new one."
                : "Connect Instagram, Facebook, Pinterest, or YouTube to start publishing."
            }
          >
            <Button
              onClick={() => (project ? setAdding(true) : setConnecting(true))}
            >
              <Plus />
              {project ? "Add from library" : "Connect your first account"}
            </Button>
          </EmptyState>
        </div>
      )}
      {reconnecting && (
        <ReconnectDialog
          account={reconnecting}
          busy={connect.isPending}
          error={connect.error}
          onClose={() => setReconnecting(null)}
          onConnect={() =>
            connect.mutate({
              platform:
                reconnecting.provider === "facebook"
                  ? "meta"
                  : reconnecting.provider,
              reconnectAccountId: reconnecting.id,
            })
          }
        />
      )}
      {connecting && (
        <ConnectDialog
          busy={connect.isPending}
          error={connect.error}
          onConnect={(platform) => connect.mutate({ platform })}
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
  onConnect,
  onClose,
  busy,
  error,
}: {
  onConnect: (platform: Provider) => void;
  onClose: () => void;
  busy: boolean;
  error: unknown;
}) {
  const providers = useDialogLoader<z.infer<typeof providerStatusSchema>[]>(
    "/resources/providers",
  );
  return (
    <Modal
      title="Connect a social account"
      description="Sign in securely with the platform. Choose the accounts you want to add after authorization."
      onClose={onClose}
    >
      <div className="form-stack">
        {connectionProviders.map((platform) => {
          const ready = providers.data?.find(
            (p) => p.provider === platform,
          )?.configured;
          return (
            <Button
              key={platform}
              className="provider-button"
              variant="outline"
              disabled={busy || !ready}
              onClick={() => onConnect(platform)}
            >
              <PlatformIcon
                platform={platform === "meta" ? "facebook" : platform}
              />
              <span>
                {platform === "meta"
                  ? "Connect Facebook & Instagram"
                  : providerNames[platform]}
              </span>
              <small>{ready ? "Connect" : "App setup required"}</small>
            </Button>
          );
        })}
        <p className="help-text">
          App setup is configured in the server environment. See the setup guide
          for callback URLs and permissions.
        </p>
        <ErrorMessage error={error || providers.error} />
      </div>
    </Modal>
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
    `/projects/${project.id}/accounts`,
    (accountId) => ({ intent: "assign", accountId }),
  );
  return (
    <Modal
      title="Add accounts from your library"
      description={`Select the accounts ${project.name} can publish to. No credentials are copied.`}
      onClose={onClose}
    >
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
            title="Your library is empty"
            description="Connect an account first, then add it to your project."
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
    <Modal
      title={`Add ${account.name} to a project`}
      description="The project gets publishing access. Its content remains separate."
      onClose={onClose}
    >
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
  onConnect: () => void;
  onClose: () => void;
}) {
  const impact = useDialogLoader<z.infer<typeof impactSchema>>(
    `/resources/accounts/${account.id}/impact`,
  );
  return (
    <Modal
      title={`Reconnect ${account.name}?`}
      description="Signing in replaces access for every destination sharing this authorization. Existing projects and publishing history are preserved."
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
        <Button disabled={busy || !impact.data} onClick={onConnect}>
          Continue to sign in
        </Button>
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
      description="Select the publishing destinations to save in your shared library."
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
