import { Outlet, useLocation, useNavigation } from "react-router";
import { useRouterRefresh } from "@/hooks/use-router-refresh";
export function RootLayout() {
  const location = useLocation();
  const navigation = useNavigation();
  useRouterRefresh(location.pathname.startsWith("/projects/"));
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {navigation.state !== "idle" && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-primary"
        >
          <span className="sr-only">Loading page…</span>
        </div>
      )}
      <Outlet />
    </>
  );
}
