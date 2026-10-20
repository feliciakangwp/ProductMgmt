import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Alert } from '../components/ui';

/** Shown instead of a blank page when a screen fails to render. */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';
  return (
    <div className="mx-auto max-w-xl p-8">
      <Alert tone="error" title="This page could not be displayed">
        <p>{message}</p>
        <p className="mt-2">
          Reload the page to try again, or{' '}
          <Link to="/projects" className="font-medium underline">
            go to your projects
          </Link>
          .
        </p>
      </Alert>
    </div>
  );
}
