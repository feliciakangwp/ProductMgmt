import { clsx } from 'clsx';
import { Workflow } from 'lucide-react';

export function Logo({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-white shadow-sm">
        <Workflow className="size-4.5" aria-hidden />
      </div>
      {compact ? null : (
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">
          ProductFlow <span className="text-brand-700">AI</span>
        </span>
      )}
    </div>
  );
}
