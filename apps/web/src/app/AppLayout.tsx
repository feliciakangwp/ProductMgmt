import { ChevronDown, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useMatch, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Select } from '../components/ui';
import { safeStorage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { useProjects } from '../modules/projects/api';
import { Sidebar } from './Sidebar';

export const LAST_PROJECT_KEY = 'productflow:lastProject';
const SIDEBAR_KEY = 'productflow:sidebarCollapsed';

export function AppLayout() {
  const [preferCollapsed, setPreferCollapsed] = useState(() => safeStorage.get(SIDEBAR_KEY) === '1');
  // The process designer needs the width; collapse the sidebar there unless the user expands it.
  const inDesigner = Boolean(useMatch('/projects/:projectId/processes/:processId'));
  const [expandedInDesigner, setExpandedInDesigner] = useState(false);
  const collapsed = inDesigner ? !expandedInDesigner : preferCollapsed;
  const match = useMatch('/projects/:projectId/*');
  const routeProjectId = match?.params.projectId ?? null;
  const projects = useProjects();
  const lastProject = safeStorage.get(LAST_PROJECT_KEY);
  const projectId = routeProjectId ?? (lastProject && projects.data?.some((p) => p.id === lastProject) ? lastProject : null);

  useEffect(() => {
    if (routeProjectId) safeStorage.set(LAST_PROJECT_KEY, routeProjectId);
  }, [routeProjectId]);

  return (
    <div className="flex h-full">
      <Sidebar
        collapsed={collapsed}
        projectId={projectId}
        onToggle={() => {
          if (inDesigner) {
            setExpandedInDesigner(collapsed);
            return;
          }
          setPreferCollapsed(!collapsed);
          safeStorage.set(SIDEBAR_KEY, collapsed ? '0' : '1');
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar projectId={projectId} />
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function TopBar({ projectId }: { projectId: string | null }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const projects = useProjects();
  const [menuOpen, setMenuOpen] = useState(false);
  const name = (session?.user.user_metadata?.display_name as string | undefined) || session?.user.email || '';

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Project</span>
        {projects.data && projects.data.length > 0 ? (
          <Select
            aria-label="Current project"
            className="h-8 w-64 text-sm"
            value={projectId ?? ''}
            onChange={(e) => navigate(e.target.value ? `/projects/${e.target.value}/processes` : '/projects')}
          >
            <option value="">Select a project…</option>
            {projects.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} · {p.name}
              </option>
            ))}
          </Select>
        ) : (
          <Link to="/projects" className="text-sm font-medium text-brand-700 hover:underline">
            Create a project
          </Link>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-100"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="max-w-48 truncate">{name}</span>
          <ChevronDown className="size-3.5 text-slate-400" />
        </button>
        {menuOpen ? (
          <div role="menu" className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
            <button
              role="menuitem"
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate('/login');
              }}
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
