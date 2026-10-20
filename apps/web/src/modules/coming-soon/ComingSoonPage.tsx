import { Clock } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { findModule } from '../../app/navigation';
import { EmptyState } from '../../components/ui';

export function ComingSoonPage() {
  const { slug = '' } = useParams();
  const module = findModule(slug);
  if (!module) {
    return (
      <div className="p-8">
        <EmptyState
          title="Page not found"
          action={
            <Link className="text-sm font-medium text-brand-700 hover:underline" to="/">
              Go to your projects
            </Link>
          }
        />
      </div>
    );
  }
  const Icon = module.icon;
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-slate-200 text-slate-500">
          <Icon className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{module.label}</h1>
          <p className="text-sm text-slate-500">Planned for delivery phase {module.phase}</p>
        </div>
      </div>
      <EmptyState icon={<Clock className="size-8" />} title="Coming soon">
        <p>{module.summary}</p>
        <p className="mt-2">
          This module will build on the processes and identifiers you create in the Process Designer, so everything you model now
          stays traceable when it arrives.
        </p>
      </EmptyState>
    </div>
  );
}
