import { createBrowserRouter, createMemoryRouter, Navigate } from 'react-router';
import { backend } from '../lib/backend';
import { LoginPage } from '../auth/LoginPage';
import { ResetPasswordPage } from '../auth/ResetPasswordPage';
import { ComingSoonPage } from '../modules/coming-soon/ComingSoonPage';
import { ProcessListPage } from '../modules/processes/ProcessListPage';
import { MembersPage } from '../modules/projects/MembersPage';
import { ProjectsPage } from '../modules/projects/ProjectsPage';
import { safeStorage } from '../lib/storage';
import { Spinner } from '../components/ui';
import { useProjects } from '../modules/projects/api';
import { AppLayout, LAST_PROJECT_KEY } from './AppLayout';
import { RequireAuth } from './RequireAuth';
import { RouteError } from './RouteError';

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
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
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
      {
        path: 'projects/:projectId/data',
        lazy: () => import('../modules/data-requirements/DataHomePage').then((m) => ({ Component: m.DataHomePage })),
      },
      {
        path: 'projects/:projectId/data/processes/:processId',
        lazy: () => import('../modules/data-requirements/IoEditorPage').then((m) => ({ Component: m.IoEditorPage })),
      },
      {
        path: 'projects/:projectId/data/dictionary',
        lazy: () => import('../modules/data-requirements/DictionaryPage').then((m) => ({ Component: m.DictionaryPage })),
      },
      {
        path: 'projects/:projectId/data/rules',
        lazy: () => import('../modules/data-requirements/BusinessRulesPage').then((m) => ({ Component: m.BusinessRulesPage })),
      },
      {
        path: 'projects/:projectId/stories',
        lazy: () => import('../modules/delivery/StoriesPage').then((m) => ({ Component: m.StoriesPage })),
      },
      {
        path: 'projects/:projectId/scenarios',
        lazy: () => import('../modules/delivery/ScenariosPage').then((m) => ({ Component: m.ScenariosPage })),
      },
      {
        path: 'projects/:projectId/backlog',
        lazy: () => import('../modules/delivery/BacklogPage').then((m) => ({ Component: m.BacklogPage })),
      },
      {
        path: 'projects/:projectId/sprints',
        lazy: () => import('../modules/delivery/SprintsPage').then((m) => ({ Component: m.SprintsPage })),
      },
      {
        path: 'projects/:projectId/kanban',
        lazy: () => import('../modules/delivery/KanbanPage').then((m) => ({ Component: m.KanbanPage })),
      },
      {
        path: 'projects/:projectId/testing',
        lazy: () => import('../modules/delivery/TestingPage').then((m) => ({ Component: m.TestingPage })),
      },
      {
        path: 'projects/:projectId/testing/:executionId',
        lazy: () => import('../modules/delivery/TestingPage').then((m) => ({ Component: m.ExecutionPage })),
      },
      {
        path: 'projects/:projectId/defects',
        lazy: () => import('../modules/delivery/DefectsPage').then((m) => ({ Component: m.DefectsPage })),
      },
      {
        path: 'projects/:projectId/dashboard',
        lazy: () => import('../modules/delivery/DashboardPage').then((m) => ({ Component: m.DashboardPage })),
      },
      {
        path: 'projects/:projectId/insights',
        lazy: () => import('../modules/delivery/InsightsPage').then((m) => ({ Component: m.InsightsPage })),
      },
      {
        path: 'projects/:projectId/trace',
        lazy: () => import('../modules/delivery/TracePage').then((m) => ({ Component: m.TracePage })),
      },
      {
        path: 'projects/:projectId/settings',
        lazy: () => import('../modules/delivery/SettingsPage').then((m) => ({ Component: m.SettingsPage })),
      },
      { path: 'modules/:slug', element: <ComingSoonPage /> },
      { path: '*', element: <ComingSoonPage /> },
    ],
  },
]);
