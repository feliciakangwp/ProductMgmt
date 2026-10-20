import { BookOpen, GitBranch, Scale, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, EmptyState, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useProcesses } from '../processes/api';
import { VersionStatusBadge } from '../processes/VersionStatusBadge';
import { useBusinessRules, useFields, useValidationRules } from './api';
import { DataModuleLayout } from './DataModuleLayout';

/** Entry point of the Input & Output Designer: pick a process to define its activities' data. */
export function DataHomePage() {
  const { projectId = '' } = useParams();
  const processes = useProcesses(projectId);
  const fields = useFields(projectId);
  const rules = useValidationRules(projectId);
  const businessRules = useBusinessRules(projectId);
  const draftFields = fields.data?.filter((f) => f.status === 'draft').length ?? 0;

  return (
    <DataModuleLayout
      title="Data requirements"
      description="Define the inputs, outputs and validation rules of each process activity, backed by one shared data dictionary."
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          icon={<BookOpen className="size-4" />}
          label="Dictionary fields"
          value={fields.data?.length}
          note={draftFields ? `${draftFields} to confirm` : 'All confirmed'}
          to={`/projects/${projectId}/data/dictionary`}
        />
        <Stat
          icon={<ShieldCheck className="size-4" />}
          label="Validation rules"
          value={rules.data?.length}
          note={`${rules.data?.filter((r) => r.status === 'draft').length ?? 0} to confirm`}
          to={`/projects/${projectId}/data/dictionary`}
        />
        <Stat
          icon={<Scale className="size-4" />}
          label="Business rules"
          value={businessRules.data?.length}
          note={`${businessRules.data?.filter((r) => r.status === 'approved').length ?? 0} approved`}
          to={`/projects/${projectId}/data/rules`}
        />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-slate-900">Processes</h2>
      {processes.isPending ? <Spinner /> : null}
      {processes.error ? <Alert tone="error">{errorMessage(processes.error)}</Alert> : null}
      {processes.data && processes.data.length === 0 ? (
        <EmptyState icon={<GitBranch className="size-8" />} title="No processes yet">
          Create a process map in the Process Designer first. Its activities are where inputs and outputs are defined.
        </EmptyState>
      ) : null}
      {processes.data && processes.data.length > 0 ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {processes.data.map((p) => {
            const version = p.versions.find((v) => v.status === 'draft') ?? p.versions[0];
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="font-mono text-xs text-slate-500">{p.ref_code}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{p.name}</span>
                {version ? (
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    v{version.version_number} <VersionStatusBadge status={version.status} />
                  </span>
                ) : null}
                <Link
                  to={`/projects/${projectId}/data/processes/${p.id}`}
                  className="inline-flex h-8 items-center rounded-md bg-brand-700 px-3 text-xs font-medium text-white hover:bg-brand-800"
                >
                  Define inputs &amp; outputs
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </DataModuleLayout>
  );
}

function Stat({
  icon,
  label,
  value,
  note,
  to,
}: {
  icon: ReactNode;
  label: string;
  value: number | undefined;
  note: string;
  to: string;
}) {
  return (
    <Link to={to} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {icon} {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{value ?? '–'}</p>
      <p className="text-xs text-slate-500">{note}</p>
    </Link>
  );
}
