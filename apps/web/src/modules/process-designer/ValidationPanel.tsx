import type { ValidationIssue } from '@productflow/domain';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { Dispatch } from 'react';
import type { DesignerAction } from './designer-state';

export function ValidationPanel({ issues, dispatch }: { issues: ValidationIssue[]; dispatch: Dispatch<DesignerAction> }) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 py-10 text-center text-sm text-slate-500">
        <CheckCircle2 className="mb-2 size-6 text-emerald-500" />
        No validation issues. The process map is structurally complete.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <p className="text-xs text-slate-500">
        Errors must be fixed before the process can be approved. Warnings should be reviewed and are acknowledged at approval.
      </p>
      <IssueGroup title="Errors" issues={errors} dispatch={dispatch} />
      <IssueGroup title="Warnings" issues={warnings} dispatch={dispatch} />
    </div>
  );
}

function IssueGroup({
  title,
  issues,
  dispatch,
}: {
  title: string;
  issues: ValidationIssue[];
  dispatch: Dispatch<DesignerAction>;
}) {
  if (issues.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {title} ({issues.length})
      </h3>
      <ul className="space-y-1.5">
        {issues.map((issue) => {
          const target = issue.edgeKeys[0]
            ? { kind: 'edge' as const, key: issue.edgeKeys[0] }
            : issue.nodeKeys[0]
              ? { kind: 'node' as const, key: issue.nodeKeys[0] }
              : null;
          const Icon = issue.severity === 'error' ? XCircle : AlertTriangle;
          return (
            <li key={issue.id}>
              <button
                type="button"
                disabled={!target}
                onClick={() => target && dispatch({ type: 'select', selection: target })}
                className={clsx(
                  'flex w-full gap-2 rounded-md border px-2.5 py-2 text-left text-xs',
                  issue.severity === 'error'
                    ? 'border-red-200 bg-red-50 text-red-900'
                    : 'border-amber-200 bg-amber-50 text-amber-900',
                  target && 'hover:brightness-95',
                )}
              >
                <Icon
                  className={clsx('mt-px size-3.5 shrink-0', issue.severity === 'error' ? 'text-red-600' : 'text-amber-600')}
                />
                <span>{issue.message}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
