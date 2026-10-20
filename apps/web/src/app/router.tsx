import { createBrowserRouter, Navigate } from 'react-router';
import { LoginPage } from '../auth/LoginPage';
import { ComingSoonPage } from '../modules/coming-soon/ComingSoonPage';
import { ProcessListPage } from '../modules/processes/ProcessListPage';
import { MembersPage } from '../modules/projects/MembersPage';
import { ProjectsPage } from '../modules/projects/ProjectsPage';
import { safeStorage } from '../lib/storage';
import { AppLayout, LAST_PROJECT_KEY } from './AppLayout';
import { RequireAuth } from './RequireAuth';

function HomeRedirect() {
  const last = safeStorage.get(LAST_PROJECT_KEY);
  return <Navigate to={last ? `/projects/${last}/processes` : '/projects'} replace />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:projectId', element: <Navigate to="processes" replace /> },
      { path: 'projects/:projectId/members', element: <MembersPage /> },
      { path: 'projects/:projectId/processes', element: <ProcessListPage /> },
      {
        path: 'projects/:projectId/processes/:processId',
        // React Flow and the designer are the bulk of the bundle; load them on demand.
        lazy: () => import('../modules/process-designer/DesignerPage').then((m) => ({ Component: m.DesignerPage })),
      },
      { path: 'modules/:slug', element: <ComingSoonPage /> },
      { path: '*', element: <ComingSoonPage /> },
    ],
  },
]);
