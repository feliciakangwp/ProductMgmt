import { clsx } from 'clsx';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { NavLink } from 'react-router';
import { Logo } from './Logo';
import { NAVIGATION, type NavModule } from './navigation';

export function Sidebar({
  collapsed,
  onToggle,
  projectId,
}: {
  collapsed: boolean;
  onToggle: () => void;
  projectId: string | null;
}) {
  return (
    <aside
      className={clsx(
        'flex h-full shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
      aria-label="Main navigation"
    >
      <div className={clsx('flex h-14 items-center border-b border-slate-200', collapsed ? 'justify-center' : 'px-4')}>
        <Logo compact={collapsed} />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-4">
        {NAVIGATION.map((group) => (
          <div key={group.label}>
            {collapsed ? (
              <div className="mx-3 mb-2 border-t border-slate-200" aria-hidden />
            ) : (
              <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{group.label}</p>
            )}
            <ul className="space-y-0.5">
              {group.modules.map((module) => (
                <li key={module.slug}>
                  <NavItem module={module} collapsed={collapsed} projectId={projectId} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <button
        type="button"
        onClick={onToggle}
        className="flex h-11 items-center justify-center gap-2 border-t border-slate-200 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <ChevronsRight className="size-4" />
        ) : (
          <>
            <ChevronsLeft className="size-4" /> Collapse
          </>
        )}
      </button>
    </aside>
  );
}

function NavItem({ module, collapsed, projectId }: { module: NavModule; collapsed: boolean; projectId: string | null }) {
  const Icon = module.icon;
  const to = module.implemented && module.path ? module.path(projectId) : `/modules/${module.slug}`;
  return (
    <NavLink
      to={to}
      end={module.slug === 'projects'}
      title={collapsed ? `${module.label}${module.implemented ? '' : ' (Coming soon)'}` : undefined}
      className={({ isActive }) =>
        clsx(
          'group flex h-9 items-center gap-3 rounded-md text-sm transition-colors',
          collapsed ? 'justify-center' : 'px-3',
          isActive ? 'bg-brand-50 font-medium text-brand-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
          !module.implemented && !isActive && 'text-slate-400',
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {collapsed ? null : (
        <>
          <span className="truncate">{module.label}</span>
          {module.implemented ? null : (
            <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">Soon</span>
          )}
        </>
      )}
    </NavLink>
  );
}
