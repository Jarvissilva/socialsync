import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, type LoaderFunctionArgs } from "react-router";
import { postInputSchema, postSchema } from "@social/shared";
import { rootLoader, projectLoader, workspaceAction } from "./workspace";
import {
  postsLoader,
  composeLoader,
  composeAction,
  postsAction,
} from "./posts";
import { mediaAction } from "./media";
import {
  accountsAction,
  boardsLoader,
  providersLoader,
  discoveryLoader,
  impactLoader,
} from "./accounts";
import { ApiError } from "@/lib/api";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const postId = "33333333-3333-4333-8333-333333333333";
const accountId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";
const project = {
  id: projectId,
  name: "Studio",
  timeZone: "UTC",
  createdAt: "now",
  accountCount: 0,
  scheduledCount: 0,
};
const health = { ok: true, workerOnline: false, publicMediaReady: false };
const post = postSchema.parse({
  ...postInputSchema.parse({ title: "Test" }),
  id: postId,
  projectId,
  state: "draft",
  scheduledAt: null,
  createdAt: "now",
  updatedAt: "now",
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const fetchMock = vi.fn<typeof fetch>();
function args(
  fields?: Record<string, string | string[]>,
  params = { projectId },
): LoaderFunctionArgs {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields || {}))
    for (const item of Array.isArray(value) ? value : [value])
      body.append(key, item);
  return {
    request: new Request(
      `http://localhost/projects/${params.projectId}/compose`,
      fields ? { method: "POST", body } : {},
    ),
    params,
    context: {},
    url: new URL("http://localhost/"),
    pattern: "/projects/:projectId/compose",
  };
}
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("loaders", () => {
  it("loads the directory and resolves the selected project and health", async () => {
    fetchMock.mockImplementation(async (url) =>
      response(
        url === "/api/projects"
          ? [project]
          : url === "/api/health"
            ? health
            : [],
      ),
    );
    expect(await rootLoader(args())).toEqual({
      projects: [project],
      accounts: [],
    });
    expect(await projectLoader(args())).toEqual({ project, health });
    await expect(
      projectLoader(args(undefined, { projectId: otherId })),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("loads a composer draft only within its project and passes abort signals", async () => {
    fetchMock.mockImplementation(async (url) =>
      response(String(url).endsWith(`/posts/${postId}`) ? post : []),
    );
    const requestArgs = { ...args(), params: { projectId, postId } };
    expect(await composeLoader(requestArgs)).toEqual({
      accounts: [],
      media: [],
      post,
    });
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toContain(`/projects/${projectId}/`);
      expect(init?.signal).toBe(requestArgs.request.signal);
      expect(new Headers(init?.headers).get("X-SocialDesk-Client")).toBe("1");
    }
  });
  it("preserves missing-post HTTP status for boundaries", async () => {
    fetchMock.mockImplementation(async (url) =>
      response(
        String(url).includes("/posts/") ? { error: "Post not found" } : [],
        String(url).includes("/posts/") ? 404 : 200,
      ),
    );
    await expect(
      composeLoader({ ...args(), params: { projectId, postId } }),
    ).rejects.toMatchObject({ status: 404, message: "Post not found" });
  });
  it("retains HTTP status even when an error response is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
    await expect(postsLoader(args())).rejects.toMatchObject({
      status: 503,
      message: "Request failed (503).",
    });
  });
  it("does not replace aborted navigation with an error or an empty list", async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
    const controller = new AbortController();
    const pending = postsLoader({
      ...args(),
      request: new Request("http://localhost/", { signal: controller.signal }),
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("aborts the old project when switching projects", async () => {
    let oldSignal: AbortSignal | null | undefined;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).includes(projectId)) {
        oldSignal = init?.signal;
        return new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        );
      }
      return response([]);
    });
    const router = createMemoryRouter(
      [
        {
          path: "/projects/:projectId/posts",
          id: "posts",
          loader: postsLoader,
        },
      ],
      { initialEntries: [`/projects/${projectId}/posts`] },
    );
    await router.navigate(`/projects/${otherId}/posts`);
    expect(oldSignal?.aborted).toBe(true);
    expect(router.state.loaderData.posts).toEqual({ posts: [] });
    expect(router.state.errors).toBeNull();
    router.dispose();
  });
  it("exposes API failures to the matched route boundary", async () => {
    fetchMock.mockResolvedValue(response({ error: "Unavailable" }, 503));
    const boundaryRouter = createMemoryRouter([
      {
        path: "/",
        id: "page",
        loader: (a) => postsLoader({ ...a, params: { projectId } }),
        hasErrorBoundary: true,
      },
    ]);
    await vi.waitFor(() => expect(boundaryRouter.state.initialized).toBe(true));
    expect(boundaryRouter.state.errors?.page).toBeInstanceOf(ApiError);
    boundaryRouter.dispose();
  });
});

describe("actions", () => {
  it("validates intents and project fields before sending anything", async () => {
    expect(
      await workspaceAction(
        args({ intent: "save-settings", name: "", timeZone: "invalid" }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      await postsAction(args({ intent: "resend-everything", postId })),
    ).toMatchObject({ ok: false });
    expect(
      await composeAction(args({ intent: "draft", input: "invalid JSON" })),
    ).toMatchObject({ ok: false, error: "Invalid post data." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("returns the created project for navigation through unsaved-change protection", async () => {
    fetchMock.mockResolvedValue(response(project));
    const result = await workspaceAction(
      args({ intent: "create-project", name: " Studio ", timeZone: "UTC" }),
    );
    expect(result).toEqual({ ok: true, value: project });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      name: "Studio",
      timeZone: "UTC",
    });
  });
  it("returns API errors inline but throws unexpected failures", async () => {
    fetchMock.mockResolvedValueOnce(
      response({ error: "Assignment has pending work" }, 409),
    );
    expect(
      await accountsAction(args({ intent: "remove-account", accountId })),
    ).toEqual({ ok: false, error: "Assignment has pending work" });
    fetchMock.mockRejectedValueOnce(new Error("Unexpected failure"));
    await expect(
      accountsAction(args({ intent: "remove-account", accountId })),
    ).rejects.toThrow("Unexpected failure");
  });
  it("treats malformed API responses as unexpected boundary errors", async () => {
    fetchMock.mockResolvedValue(response({ invalid: true }));
    await expect(
      workspaceAction(
        args({ intent: "save-settings", name: "Studio", timeZone: "UTC" }),
      ),
    ).rejects.toThrow("The server returned an invalid response.");
  });
  it("returns invalid publishing times inline before saving a draft", async () => {
    expect(
      await composeAction(
        args({
          intent: "schedule",
          input: "{}",
          time: "invalid",
          timeZone: "UTC",
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: "Choose a valid publishing date and time.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps draft saves in the editor", async () => {
    fetchMock.mockImplementation(async () => response(post));
    const input = JSON.stringify(postInputSchema.parse(post));
    expect(await composeAction(args({ intent: "draft", input }))).toEqual({
      ok: true,
      value: { postId, baseline: input },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["schedule", "publish"])(
    "redirects after a successful %s",
    async (intent) => {
      fetchMock.mockImplementation(async () => response(post));
      const result = await composeAction(
        args({
          intent,
          input: "{}",
          time: "2030-01-01T09:00",
          timeZone: "UTC",
        }),
      );
      expect(result instanceof Response && result.headers.get("Location")).toBe(
        `/projects/${projectId}/posts`,
      );
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        `/api/projects/${projectId}/posts/${postId}/schedule`,
      );
      expect(
        JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).immediate,
      ).toBe(intent === "publish");
    },
  );
  it("retains a saved ID after schedule failure and retries by updating that draft", async () => {
    fetchMock
      .mockResolvedValueOnce(response(post))
      .mockResolvedValueOnce(response({ error: "Scheduler unavailable" }, 503));
    const fields = {
      intent: "schedule",
      input: "{}",
      time: "2030-01-01T09:00",
      timeZone: "UTC",
    };
    expect(await composeAction(args(fields))).toEqual({
      ok: false,
      error: "Scheduler unavailable",
      savedPostId: postId,
    });
    fetchMock.mockImplementation(async () => response(post));
    await composeAction(args({ ...fields, postId }));
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `/api/projects/${projectId}/posts/${postId}`,
    );
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("PUT");
  });
  it("retains a saved ID when the scheduling response is lost", async () => {
    fetchMock
      .mockResolvedValueOnce(response(post))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(
      await composeAction(args({ intent: "publish", input: "{}" })),
    ).toMatchObject({ ok: false, savedPostId: postId });
  });
  it("preserves multipart file bytes and does not forward the intent as upload metadata", async () => {
    const file = new File(["test image"], "image.png", { type: "image/png" });
    const form = new FormData();
    form.set("intent", "upload-media");
    form.set("file", file);
    fetchMock.mockResolvedValue(
      response({
        id: postId,
        projectId,
        name: file.name,
        mime: file.type,
        size: file.size,
        createdAt: "now",
      }),
    );
    expect(
      await mediaAction({
        ...args(),
        request: new Request("http://localhost/", {
          method: "POST",
          body: form,
        }),
      }),
    ).toMatchObject({ ok: true });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBeInstanceOf(FormData);
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
    const sent = init?.body as FormData;
    expect(sent.has("intent")).toBe(false);
    expect(await (sent.get("file") as File).text()).toBe("test image");
  });
  it("assigns within the URL scope even if another project is submitted", async () => {
    fetchMock.mockResolvedValue(response({ ok: true }));
    await accountsAction(
      args({ intent: "assign", accountId, projectId: otherId }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/projects/${projectId}/accounts`,
    );
  });
  it("returns a document redirect for OAuth", async () => {
    fetchMock.mockResolvedValue(
      response({ url: "https://provider.example/authorize" }),
    );
    const result = await accountsAction(
      args({
        intent: "connect",
        platform: "meta",
        reconnectAccountId: accountId,
      }),
    );
    expect(
      result instanceof Response &&
        result.headers.get("X-Remix-Reload-Document"),
    ).toBe("true");
  });
  it("preserves multiple selected OAuth destinations and requires disconnect confirmation", async () => {
    fetchMock.mockResolvedValue(
      response({ accountIds: [accountId], projectId }),
    );
    await accountsAction(
      args({
        intent: "save-discovery",
        discoveryId: postId,
        externalIds: ["one", "two"],
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      externalIds: ["one", "two"],
    });
    expect(
      await accountsAction(args({ intent: "disconnect", accountId })),
    ).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["cancel", "retry", "published", "not_published", "duplicate"])(
    "supports explicit %s without automatically resending",
    async (intent) => {
      fetchMock.mockImplementation(async () => response(post));
      await postsAction(
        args({
          intent,
          postId,
          jobId,
          verified: "true",
          remoteId: "remote-post",
        }),
      );
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(
        urls.every((url) => url.startsWith(`/api/projects/${projectId}/posts`)),
      ).toBe(true);
      if (intent === "published" || intent === "not_published") {
        expect(urls).toEqual([
          `/api/projects/${projectId}/posts/${postId}/destinations/${jobId}/resolve`,
        ]);
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
          resolution: intent,
          verified: true,
          remoteId: "remote-post",
        });
      }
      if (intent === "duplicate")
        expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    },
  );
  it("revalidates loader data automatically after an action", async () => {
    let reads = 0;
    fetchMock.mockImplementation(async () => response(post));
    const router = createMemoryRouter(
      [
        {
          path: "/projects/:projectId/posts",
          id: "posts",
          loader: () => ++reads,
          action: postsAction,
        },
      ],
      { initialEntries: [`/projects/${projectId}/posts`] },
    );
    await vi.waitFor(() => expect(router.state.initialized).toBe(true));
    await router.navigate(`/projects/${projectId}/posts`, {
      formMethod: "post",
      formData: (() => {
        const f = new FormData();
        f.set("intent", "cancel");
        f.set("postId", postId);
        return f;
      })(),
    });
    expect(reads).toBe(2);
    expect(router.state.errors).toBeNull();
    router.dispose();
  });
});

describe("dialog fetcher loaders", () => {
  it("validates the combined provider and mixed-platform discovery contracts", async () => {
    const providers = [{ provider: "meta", configured: true, missing: [] }];
    const discovery = {
      id: postId,
      provider: "meta",
      projectId,
      candidates: [
        {
          platform: "facebook",
          externalId: "page",
          name: "Page",
          username: "",
          capabilities: ["text"],
        },
        {
          platform: "instagram",
          externalId: "ig",
          name: "Creator",
          username: "creator",
          capabilities: ["image"],
        },
      ],
    };
    fetchMock.mockImplementation(async (url) =>
      response(String(url).endsWith("providers") ? providers : discovery),
    );
    expect(await providersLoader(args())).toEqual({
      ok: true,
      value: providers,
    });
    expect(
      await discoveryLoader({ ...args(), params: { discoveryId: postId } }),
    ).toEqual({ ok: true, value: discovery });
    fetchMock.mockResolvedValue(
      response({ url: "https://www.facebook.com/dialog/oauth" }),
    );
    const result = await accountsAction(
      args({ intent: "connect", platform: "meta" }),
    );
    expect(fetchMock.mock.lastCall?.[0]).toBe("/api/accounts/connect/meta");
    expect(result).toBeInstanceOf(Response);
    expect(
      result instanceof Response &&
        result.headers.get("X-Remix-Reload-Document"),
    ).toBe("true");
  });
  it("loads providers, discoveries, disconnect impact and project boards on demand", async () => {
    fetchMock.mockImplementation(async (url) =>
      response(
        String(url).endsWith("impact")
          ? { accounts: [], projects: [], pendingCount: 0 }
          : String(url).includes("discoveries")
            ? { id: postId, provider: "meta", projectId, candidates: [] }
            : [],
      ),
    );
    expect(await providersLoader(args())).toEqual({ ok: true, value: [] });
    expect(
      await discoveryLoader({ ...args(), params: { discoveryId: postId } }),
    ).toMatchObject({ ok: true });
    expect(
      await impactLoader({ ...args(), params: { accountId } }),
    ).toMatchObject({ ok: true });
    expect(
      await boardsLoader({ ...args(), params: { projectId, accountId } }),
    ).toEqual({ ok: true, value: [] });
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      `/api/projects/${projectId}/accounts/${accountId}/boards`,
    );
  });
});
