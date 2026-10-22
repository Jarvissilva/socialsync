import { Link, useRouteError, isRouteErrorResponse } from "react-router";
import { ApiError } from "@/lib/api";
import { ErrorMessage } from "@/components/feedback/Feedback";
export function NotFoundPage() {
  return (
    <main id="main-content" className="directory">
      <h1>Page not found</h1>
      <p>This page may have moved.</p>
      <Link to="/">Back to projects</Link>
    </main>
  );
}
export function RouteErrorPage() {
  const error = useRouteError();
  const status =
    isRouteErrorResponse(error) || error instanceof ApiError
      ? error.status
      : undefined;
  const message = isRouteErrorResponse(error) ? error.data : error;
  return (
    <main id="main-content" className="directory">
      <h1>{status === 404 ? "Page not found" : "Something went wrong"}</h1>
      <ErrorMessage error={message} />
      <Link to="/">Back to projects</Link>
    </main>
  );
}
