import { clsx } from 'clsx';
import { ChevronsLeft, ChevronsRight, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Textarea } from '../../components/ui';

const MAX_LENGTH = 20000;
const MIN_LENGTH = 20;

export function DescriptionPanel({
  description,
  onChange,
  readOnly,
  canAnalyse,
  analysing,
  error,
  onAnalyse,
}: {
  description: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  canAnalyse: boolean;
  analysing: boolean;
  error: string | null;
  onAnalyse: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const tooShort = description.trim().length < MIN_LENGTH;

  if (collapsed) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center border-r border-slate-200 bg-white py-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
          aria-label="Show process description"
        >
          <ChevronsRight className="size-4" />
        </button>
        <span className="mt-4 text-xs font-medium text-slate-500 [writing-mode:vertical-rl]">Process description</span>
      </div>
    );
  }

  return (
    <section className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white 2xl:w-96" aria-label="Process description">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">Process description</h2>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Hide process description"
        >
          <ChevronsLeft className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <p className="text-xs text-slate-500">
          Describe the process in your own words: who starts it, each step and who performs it, the decisions and approvals, and
          what happens when something is rejected or goes wrong.
        </p>
        <Textarea
          aria-label="Process description"
          className="min-h-48 flex-1 resize-none font-[450]"
          value={description}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          maxLength={MAX_LENGTH}
          placeholder={
            'When a Finance Officer receives a request for debt write-off, the officer retrieves the debt record.\n\nThe officer checks whether the debt has been outstanding for more than five years…'
          }
        />
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>{readOnly ? 'Read only' : 'Saved with the draft'}</span>
          <span className={clsx(description.length > MAX_LENGTH * 0.9 && 'text-amber-600')}>
            {description.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
          </span>
        </div>
        {error ? (
          <Alert tone="error" title="Analysis failed">
            {error}
          </Alert>
        ) : null}
        {canAnalyse ? (
          <>
            <Button
              variant="primary"
              icon={<Sparkles className="size-4" />}
              loading={analysing}
              disabled={tooShort}
              onClick={onAnalyse}
            >
              {analysing ? 'Analysing…' : 'Analyse & Generate Process Map'}
            </Button>
            <p className="text-[11px] text-slate-500">
              {analysing
                ? 'Claude is identifying activities, actors, decisions and rules. This can take up to a minute.'
                : tooShort
                  ? 'Write at least a sentence or two to analyse.'
                  : 'You review the result before it changes the draft. AI suggestions stay in Draft until accepted.'}
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
