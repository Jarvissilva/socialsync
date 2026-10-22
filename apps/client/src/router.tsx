import { createBrowserRouter } from "react-router";
import { Loading } from "@/components/feedback/Feedback";
import { RootLayout } from "@/layouts/RootLayout";
import { HomePage } from "@/pages/HomePage";
import { NotFoundPage, RouteErrorPage } from "@/pages/NotFoundPage";
import {
  rootLoader,
  projectLoader,
  settingsLoader,
  workspaceAction,
} from "@/routes/workspace";
import {
  postsLoader,
  postsAction,
  composeLoader,
  composeAction,
} from "@/routes/posts";
import { mediaLoader, mediaAction } from "@/routes/media";
import {
  accountsLoader,
  accountsAction,
  providersLoader,
  discoveryLoader,
  impactLoader,
  boardsLoader,
} from "@/routes/accounts";
export const routes = [
  {
    id: "root",
    loader: rootLoader,
    Component: RootLayout,
    HydrateFallback: Loading,
    ErrorBoundary: RouteErrorPage,
    children: [
      { id: "home", path: "/", Component: HomePage },
      {
        id: "account-library",
        path: "/accounts",
        loader: accountsLoader,
        action: accountsAction,
        lazy: async () => ({
          Component: (await import("@/pages/AccountsPage")).AccountLibraryPage,
        }),
      },
      {
        path: "/projects/:projectId",
        id: "project",
        loader: projectLoader,
        ErrorBoundary: RouteErrorPage,
        lazy: async () => ({
          Component: (await import("@/layouts/ProjectLayout")).ProjectLayout,
        }),
        children: [
          {
            id: "calendar",
            index: true,
            loader: postsLoader,
            action: postsAction,
            lazy: async () => ({
              Component: (await import("@/pages/CalendarPage")).CalendarPage,
            }),
          },
          {
            id: "posts",
            path: "posts",
            loader: postsLoader,
            action: postsAction,
            lazy: async () => ({
              Component: (await import("@/pages/PostsPage")).PostsPage,
            }),
          },
          {
            id: "compose",
            path: "compose",
            loader: composeLoader,
            action: composeAction,
            lazy: async () => ({
              Component: (await import("@/pages/ComposePage")).ComposePage,
            }),
          },
          {
            id: "edit-post",
            path: "compose/:postId",
            loader: composeLoader,
            action: composeAction,
            lazy: async () => ({
              Component: (await import("@/pages/ComposePage")).ComposePage,
            }),
          },
          {
            id: "media",
            path: "media",
            loader: mediaLoader,
            action: mediaAction,
            lazy: async () => ({
              Component: (await import("@/pages/MediaPage")).MediaPage,
            }),
          },
          {
            id: "project-accounts",
            path: "accounts",
            loader: accountsLoader,
            action: accountsAction,
            lazy: async () => ({
              Component: (await import("@/pages/AccountsPage"))
                .ProjectAccountsPage,
            }),
          },
          {
            id: "settings",
            path: "settings",
            loader: settingsLoader,
            action: workspaceAction,
            lazy: async () => ({
              Component: (await import("@/pages/SettingsPage")).SettingsPage,
            }),
          },
        ],
      },
      {
        id: "project-mutations",
        path: "/resources/projects",
        action: workspaceAction,
      },
      {
        id: "providers",
        path: "/resources/providers",
        loader: providersLoader,
      },
      {
        id: "discovery",
        path: "/resources/discoveries/:discoveryId",
        loader: discoveryLoader,
      },
      {
        id: "account-impact",
        path: "/resources/accounts/:accountId/impact",
        loader: impactLoader,
      },
      {
        id: "pinterest-boards",
        path: "/projects/:projectId/resources/accounts/:accountId/boards",
        loader: boardsLoader,
      },
      { id: "not-found", path: "*", Component: NotFoundPage },
    ],
  },
];
export const router = createBrowserRouter(routes);
