import {
  FINDING_KIND_LABELS,
  FINDING_KINDS,
  newKey,
  type FindingKind,
  type FindingStatus,
  type ProcessFinding,
  type ProcessGraph,
} from '@productflow/domain';
import { clsx } from 'clsx';
import { Check, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { useState, type Dispatch } from 'react';
import { Badge, Button, Select, Textarea } from '../../components/ui';
import type { DesignerAction } from './designer-state';

const KIND_TONE: Record<FindingKind, 'blue' | 'violet' | 'amber' | 'red'> = {
  business_rule: 'blue',
  exception: 'violet',
  missing_information: 'amber',
  ambiguity: 'red',
};

export function FindingsPanel({
  findings,
  graph,
  readOnly,
  dispatch,
}: {
  findings: ProcessFinding[];
  graph: ProcessGraph;
  readOnly: boolean;
  dispatch: Dispatch<DesignerAction>;
}) {
  const [adding, setAdding] = useState(false);
  const labelOf = new Map(graph.nodes.map((n) => [n.elementKey, n.refCode ?? n.label]));
  const setStatus = (key: string, status: FindingStatus) =>
    dispatch({ type: 'updateFindings', update: (list) => list.map((f) => (f.elementKey === key ? { ...f, status } : f)) });
  const remove = (key: string) =>
    dispatch({ type: 'updateFindings', update: (list) => list.filter((f) => f.elementKey !== key) });
  const open = findings.filter((f) => f.status === 'draft');
  const decided = findings.filter((f) => f.status !== 'draft');

  return (
    <div className="space-y-4 p-4">
      <p className="text-xs text-slate-500">
        Business rules, exceptions and open questions identified in the description. AI findings stay in Draft until you accept or
        dismiss them; accepted rules carry into later requirements.
      </p>
      {readOnly ? null : adding ? (
        <NewFinding
          onCancel={() => setAdding(false)}
          onAdd={(finding) => {
            dispatch({ type: 'updateFindings', update: (list) => [...list, finding] });
            setAdding(false);
          }}
        />
      ) : (
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
          Add finding
        </Button>
      )}
      {findings.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">No findings yet.</p> : null}
      {[
        { title: 'To review', list: open },
        { title: 'Reviewed', list: decided },
      ].map(({ title, list }) =>
        list.length === 0 ? null : (
          <section key={title}>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {title} ({list.length})
            </h3>
            <ul className="space-y-2">
              {list.map((f) => (
                <li
                  key={f.elementKey}
                  className={clsx(
                    'rounded-md border bg-white p-2.5 text-xs',
                    f.status === 'dismissed' ? 'border-slate-200 opacity-60' : 'border-slate-200 shadow-sm',
                  )}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={KIND_TONE[f.kind]}>{FINDING_KIND_LABELS[f.kind]}</Badge>
                    {f.origin === 'inferred' ? (
                      <Badge tone="violet">
                        <Sparkles className="size-3" /> Inferred
                      </Badge>
                    ) : f.origin === 'stated' ? (
                      <Badge tone="green">Stated</Badge>
                    ) : (
                      <Badge>Manual</Badge>
                    )}
                    {f.status !== 'draft' ? (
                      <Badge tone={f.status === 'accepted' ? 'green' : 'slate'}>
                        {f.status === 'accepted' ? 'Accepted' : 'Dismissed'}
                      </Badge>
                    ) : null}
                  </div>
                  <p className={clsx('text-slate-800', f.status === 'dismissed' && 'line-through')}>{f.statement}</p>
                  {f.sourceText ? <p className="mt-1 text-slate-500 italic">“{f.sourceText}”</p> : null}
                  {f.relatedNodeKeys.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {f.relatedNodeKeys.map((key) =>
                        labelOf.has(key) ? (
                          <button
                            key={key}
                            type="button"
                            onClick={() => dispatch({ type: 'select', selection: { kind: 'node', key } })}
                            className="max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-brand-50 hover:text-brand-800"
                          >
                            {labelOf.get(key)}
                          </button>
                        ) : null,
                      )}
                    </div>
                  ) : null}
                  {readOnly ? null : (
                    <div className="mt-2 flex gap-1">
                      {f.status === 'draft' ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Check className="size-3.5 text-emerald-600" />}
                            onClick={() => setStatus(f.elementKey, 'accepted')}
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<X className="size-3.5" />}
                            onClick={() => setStatus(f.elementKey, 'dismissed')}
                          >
                            Dismiss
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<RotateCcw className="size-3.5" />}
                          onClick={() => setStatus(f.elementKey, 'draft')}
                        >
                          Reopen
                        </Button>
                      )}
                      {f.origin === 'manual' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto"
                          aria-label="Delete finding"
                          icon={<Trash2 className="size-3.5" />}
                          onClick={() => remove(f.elementKey)}
                        />
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

function NewFinding({ onAdd, onCancel }: { onAdd: (f: ProcessFinding) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<FindingKind>('business_rule');
  const [statement, setStatement] = useState('');
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
      <Select aria-label="Finding type" value={kind} onChange={(e) => setKind(e.target.value as FindingKind)} className="h-8">
        {FINDING_KINDS.map((k) => (
          <option key={k} value={k}>
            {FINDING_KIND_LABELS[k]}
          </option>
        ))}
      </Select>
      <Textarea
        aria-label="Statement"
        rows={3}
        value={statement}
        maxLength={2000}
        onChange={(e) => setStatement(e.target.value)}
        placeholder="e.g. Requests of $10,000 or more require Director approval."
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!statement.trim()}
          onClick={() =>
            onAdd({
              elementKey: newKey(),
              kind,
              statement: statement.trim(),
              sourceText: null,
              origin: 'manual',
              status: 'accepted',
              relatedNodeKeys: [],
            })
          }
        >
          Add
        </Button>
      </div>
    </div>
  );
}
