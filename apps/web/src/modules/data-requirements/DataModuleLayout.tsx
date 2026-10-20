import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { NavLink, useParams } from 'react-router';
import { useProject } from '../projects/api';

const TABS = [
  { to: '', label: 'Activities', end: true },
  { to: 'dictionary', label: 'Data dictionary', end: false },
  { to: 'rules', label: 'Business rules', end: false },
] as const;

/** Page frame for the Input & Output Designer: project heading and the three views. */
export function DataModuleLayout({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-8">
      <p className="text-xs font-semibold tracking-wide text-brand-700">
        {project.data?.key ?? ''} · Input &amp; Output Designer
      </p>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        {actions}
      </div>
      <nav className="mb-6 flex gap-1 border-b border-slate-200" aria-label="Input and output designer views">
        {TABS.map((tab) => (
          <NavLink
            key={tab.label}
            to={`/projects/${projectId}/data${tab.to ? `/${tab.to}` : ''}`}
            end={tab.end}
            className={({ isActive }) =>
              clsx(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                isActive ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </div>
  );
}
