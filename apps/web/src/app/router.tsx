import { createBrowserRouter, createMemoryRouter, Navigate } from 'react-router';
import { backend } from '../lib/backend';
import { LoginPage } from '../auth/LoginPage';
import { ComingSoonPage } from '../modules/coming-soon/ComingSoonPage';
import { ProcessListPage } from '../modules/processes/ProcessListPage';
import { MembersPage } from '../modules/projects/MembersPage';
import { ProjectsPage } from '../modules/projects/ProjectsPage';
import { safeStorage } from '../lib/storage';
import { Spinner } from '../components/ui';
import { useProjects } from '../modules/projects/api';
import { AppLayout, LAST_PROJECT_KEY } from './AppLayout';
import { RequireAuth } from './RequireAuth';

/** Opens the last project used, or the only project, or the project list. */
function HomeRedirect() {
  const projects = useProjects();
  if (projects.isPending) return <Spinner />;
  const list = projects.data ?? [];
  const last = safeStorage.get(LAST_PROJECT_KEY);
  const target = list.find((p) => p.id === last) ?? (list.length === 1 ? list[0] : undefined);
  return <Navigate to={target ? `/projects/${target.id}/processes` : '/projects'} replace />;
}

// The demo runs inside a shared link whose address the app does not control, so it routes in memory.
const createRouter = backend.mode === 'demo' ? createMemoryRouter : createBrowserRouter;

export const router = createRouter([
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
