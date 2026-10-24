import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router";
import { routes } from "./router";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  createBrowserRouter: vi.fn(),
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const appId = "22222222-2222-4222-8222-222222222222";
const app = {
  id: appId,
  name: "Studio",
  provider: "meta",
  clientId: "client",
  callbackUrl: "http://localhost:3002/public/oauth/meta/callback",
  linkedAccountCount: 0,
  createdAt: "now",
};
const accounts = ["instagram", "facebook"].map((platform, index) => ({
  id: `33333333-3333-4333-8333-33333333333${index}`,
  providerAppId: appId,
  provider: "meta",
  platform,
  externalId: platform,
  name: `${platform} studio account`,
  username: platform,
  status: "connected",
  projectIds: [projectId],
  capabilities: ["image"],
  createdAt: "now",
}));
const fetchMock = vi.fn<typeof fetch>();
const routers: ReturnType<typeof createMemoryRouter>[] = [];

async function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  routers.push(router);
  await vi.waitFor(() => expect(router.state.initialized).toBe(true));
  expect(router.state.errors).toBeNull();
  return router;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url, init) => {
    const body =
      url === "/api/projects"
        ? [
            {
              id: projectId,
              name: "Studio",
              timeZone: "UTC",
              createdAt: "now",
              accountCount: 0,
              scheduledCount: 0,
            },
          ]
        : url === "/api/health"
          ? { ok: true, workerOnline: false, publicMediaReady: false }
          : url === "/api/accounts" ||
              url === `/api/projects/${projectId}/accounts`
            ? init?.method
              ? { ok: true }
              : accounts
            : String(url).startsWith("/api/provider-apps")
              ? init?.method === "DELETE"
                ? { ok: true }
                : init?.method
                  ? app
                  : [app]
              : [];
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  });
});

afterEach(() => {
  for (const router of routers.splice(0)) router.dispose();
  vi.unstubAllGlobals();
});

describe("account browser routes", () => {
  it("loads configuration directly and navigates between standalone account pages", async () => {
    const router = await open("/accounts/config");
    expect(router.state.loaderData["provider-apps"]).toEqual({ apps: [app] });
    const html = renderToStaticMarkup(
      createElement(RouterProvider, { router }),
    );
    expect(html).toContain("Accounts config");
    expect(html).toContain('aria-labelledby="provider-meta"');
    expect(html).toContain('aria-labelledby="provider-pinterest"');
    expect(html).toContain('aria-labelledby="provider-youtube"');
    expect(html).toContain('aria-label="Add Pinterest configuration"');
    expect(html).toContain("No configurations yet");
    expect(router.state.matches.map(({ route }) => route.id)).toEqual([
      "root",
      "provider-apps",
    ]);
    await router.navigate("/accounts");
    expect(router.state.matches.map(({ route }) => route.id)).toEqual([
      "root",
      "account-library",
    ]);
    await router.navigate("/accounts/config");
    expect(router.state.errors).toBeNull();
    expect(router.state.loaderData["provider-apps"]).toEqual({ apps: [app] });
  });

  it.each(["", "?provider=meta&name=Studio%20app&provider=youtube"])(
    "redirects legacy configuration URLs while preserving query parameters: %s",
    async (search) => {
      const router = await open(`/provider-apps${search}`);
      expect(router.state.location.pathname).toBe("/accounts/config");
      expect(router.state.location.search).toBe(search);
      expect(router.state.loaderData["provider-apps"]).toEqual({ apps: [app] });
    },
  );

  it.each([
    { intent: "create", method: "POST", endpoint: "/api/provider-apps" },
    {
      intent: "update",
      method: "PUT",
      endpoint: `/api/provider-apps/${appId}`,
    },
    {
      intent: "delete",
      method: "DELETE",
      endpoint: `/api/provider-apps/${appId}`,
    },
  ])(
    "handles $intent submissions at the configuration route",
    async ({ intent, method, endpoint }) => {
      const router = await open("/accounts/config");
      const formData = new FormData();
      for (const [key, value] of Object.entries({
        intent,
        id: appId,
        name: "Studio",
        provider: "meta",
        clientId: "client",
        clientSecret: "test-secret",
      })) {
        formData.set(key, value);
      }
      await router.navigate("/accounts/config", {
        formMethod: "post",
        formData,
      });
      expect(router.state.errors).toBeNull();
      expect(router.state.actionData?.["provider-apps"]).toMatchObject({
        ok: true,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        endpoint,
        expect.objectContaining({ method }),
      );
      expect(router.state.location.pathname).toBe("/accounts/config");
    },
  );

  it("redirects legacy project accounts into Settings and keeps connection metadata available", async () => {
    const router = await open("/resources/provider-apps");
    expect(router.state.loaderData["provider-apps-resource"]).toEqual({
      ok: true,
      value: [app],
    });
    await router.navigate(
      `/projects/${projectId}/accounts?discovery=test&platform=instagram`,
    );
    expect(router.state.location.pathname).toBe(
      `/projects/${projectId}/settings/accounts`,
    );
    expect(router.state.location.search).toBe(
      "?discovery=test&platform=instagram",
    );
    expect(router.state.errors).toBeNull();
    expect(router.state.matches.map(({ route }) => route.id)).toEqual([
      "root",
      "project",
      "settings",
      "project-accounts",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/accounts`,
      expect.anything(),
    );
  });
  it("filters platform accounts, preserves the selected tab in the URL, and handles empty tabs", async () => {
    const router = await open("/accounts?platform=instagram");
    const render = () =>
      renderToStaticMarkup(createElement(RouterProvider, { router }));
    expect(render()).toContain("instagram studio account");
    expect(render()).not.toContain("facebook studio account");
    expect(render()).toContain("Accounts config");
    expect(render()).toContain('role="tablist"');
    await router.navigate("/accounts?platform=facebook");
    expect(render()).toContain("facebook studio account");
    expect(render()).not.toContain("instagram studio account");
    await router.navigate("/accounts?platform=youtube");
    expect(render()).toContain("No YouTube accounts");
    await router.navigate("/accounts?platform=unknown");
    expect(render()).toContain("instagram studio account");
    expect(render()).toContain("facebook studio account");
  });

  it("renders account management within Settings and submits assignments in the URL project scope", async () => {
    const router = await open(`/projects/${projectId}/settings/accounts`);
    const html = renderToStaticMarkup(
      createElement(RouterProvider, { router }),
    );
    expect(html).toContain('aria-label="Project settings"');
    expect(html).toContain("Remove from project");
    expect(html).not.toContain("Project accounts</a>");
    const formData = new FormData();
    formData.set("intent", "assign");
    formData.set("accountId", accounts[0]!.id);
    formData.set("projectId", appId);
    await router.navigate(`/projects/${projectId}/settings/accounts`, {
      formMethod: "post",
      formData,
    });
    expect(router.state.errors).toBeNull();
    expect(router.state.actionData?.["project-accounts"]).toMatchObject({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/accounts`,
      expect.objectContaining({ method: "POST" }),
    );
    await router.navigate(`/projects/${projectId}/settings`);
    expect(
      renderToStaticMarkup(createElement(RouterProvider, { router })),
    ).toContain("Publishing time zone");
  });
});
