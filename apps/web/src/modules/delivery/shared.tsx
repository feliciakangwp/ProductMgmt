import {
  DEFECT_STATUS_LABELS,
  EVENT_KINDS,
  PRIORITY_LABELS,
  STORY_STATUS_LABELS,
  UAT_STATUS_LABELS,
  WORK_STATUS_LABELS,
  type DefectStatus,
  type DeliveryEvent,
  type EventEntity,
  type Priority,
  type StoryStatus,
  type TextItem,
  type UatStatus,
  type WorkStatus,
} from '@productflow/domain';
import { ArrowDown, ArrowUp, MessageSquare, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Alert, Badge, Button, IconButton, Input, Spinner, Textarea } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useProject } from '../projects/api';
import { useDeliveryOp, type Lookups } from './api';

type Tone = 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet';

const STORY_TONE: Record<StoryStatus, Tone> = { draft: 'amber', pending_review: 'violet', approved: 'green', in_backlog: 'blue' };
const WORK_TONE: Record<WorkStatus, Tone> = {
  todo: 'slate',
  in_planning: 'slate',
  in_development: 'blue',
  ready_for_testing: 'violet',
  in_testing: 'violet',
  completed: 'green',
};
const PRIORITY_TONE: Record<Priority, Tone> = { critical: 'red', high: 'amber', medium: 'blue', low: 'slate' };
const UAT_TONE: Record<UatStatus, Tone> = {
  not_ready: 'slate',
  ready: 'blue',
  in_progress: 'violet',
  passed: 'green',
  failed: 'red',
  blocked: 'amber',
};
const DEFECT_TONE: Record<DefectStatus, Tone> = {
  open: 'red',
  assigned: 'amber',
  in_progress: 'blue',
  ready_for_retest: 'violet',
  closed: 'green',
  reopened: 'red',
};

export const StoryStatusBadge = ({ status }: { status: StoryStatus }) => (
  <Badge tone={STORY_TONE[status]}>{STORY_STATUS_LABELS[status]}</Badge>
);
export const WorkStatusBadge = ({ status }: { status: WorkStatus }) => (
  <Badge tone={WORK_TONE[status]}>{WORK_STATUS_LABELS[status]}</Badge>
);
export const PriorityBadge = ({ priority }: { priority: Priority }) => (
  <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABELS[priority]}</Badge>
);
export const UatBadge = ({ status }: { status: UatStatus }) => <Badge tone={UAT_TONE[status]}>{UAT_STATUS_LABELS[status]}</Badge>;
export const DefectStatusBadge = ({ status }: { status: DefectStatus }) => (
  <Badge tone={DEFECT_TONE[status]}>{DEFECT_STATUS_LABELS[status]}</Badge>
);

export function AiGeneratedBadge({ label = 'AI' }: { label?: string }) {
  return (
    <Badge tone="violet" title="Proposed by AI. Reviewed by a person before it is used.">
      <Sparkles className="size-3" /> {label}
    </Badge>
  );
}

/** Page frame for the delivery modules. */
export function DeliveryPage({
  projectId,
  module,
  title,
  description,
  actions,
  children,
}: {
  projectId: string;
  module: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const project = useProject(projectId);
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-8">
      <p className="text-xs font-semibold tracking-wide text-brand-700">
        {project.data?.key ?? ''} · {module}
      </p>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** Loading and error states shared by the delivery pages. */
export function Loading({ isPending, error }: { isPending: boolean; error: unknown }) {
  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (isPending) return <Spinner />;
  return null;
}

const newId = () => globalThis.crypto.randomUUID();

/** Edits an ordered list of plain-language items (flow steps, acceptance criteria, error scenarios). */
export function ItemListEditor({
  label,
  items,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  items: TextItem[];
  onChange: (items: TextItem[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const move = (i: number, d: number) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-xs font-medium text-slate-600">{label}</legend>
      {items.length === 0 && disabled ? <p className="text-sm text-slate-400">None</p> : null}
      <ol className="space-y-1.5">
        {items.map((item, i) => (
          <li key={item.id} className="flex items-start gap-1.5">
            <span className="mt-2 w-5 shrink-0 text-right text-xs text-slate-400">{i + 1}.</span>
            {disabled ? (
              <p className="flex-1 py-1.5 text-sm text-slate-800">{item.text}</p>
            ) : (
              <>
                <Textarea
                  aria-label={`${label} ${i + 1}`}
                  rows={1}
                  className="flex-1"
                  value={item.text}
                  placeholder={placeholder}
                  onChange={(e) => onChange(items.map((x) => (x.id === item.id ? { ...x, text: e.target.value } : x)))}
                />
                <IconButton
                  label="Move up"
                  icon={<ArrowUp className="size-3.5" />}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                />
                <IconButton
                  label="Move down"
                  icon={<ArrowDown className="size-3.5" />}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                />
                <IconButton
                  label={`Remove ${label.toLowerCase()} ${i + 1}`}
                  icon={<Trash2 className="size-3.5" />}
                  onClick={() => onChange(items.filter((x) => x.id !== item.id))}
                />
              </>
            )}
          </li>
        ))}
      </ol>
      {!disabled ? (
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus className="size-3.5" />}
          onClick={() => onChange([...items, { id: newId(), text: '' }])}
        >
          Add {label.toLowerCase().replace(/s$/, '')}
        </Button>
      ) : null}
    </fieldset>
  );
}

/** A checkbox list for many-to-many links. */
export function LinkPicker<T extends { id: string }>({
  label,
  options,
  selected,
  onChange,
  render,
  disabled,
  empty = 'Nothing to link yet.',
}: {
  label: string;
  options: T[];
  selected: string[];
  onChange: (ids: string[]) => void;
  render: (option: T) => ReactNode;
  disabled?: boolean;
  empty?: string;
}) {
  const [filter, setFilter] = useState('');
  const shown = disabled ? options.filter((o) => selected.includes(o.id)) : options;
  const visible = filter ? shown.filter((o) => String(render(o)).toLowerCase().includes(filter.toLowerCase())) : shown;
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-slate-600">
        {label} <span className="font-normal text-slate-400">({selected.length})</span>
      </legend>
      {shown.length === 0 ? <p className="text-sm text-slate-400">{disabled ? 'None' : empty}</p> : null}
      {!disabled && options.length > 8 ? (
        <Input
          aria-label={`Filter ${label.toLowerCase()}`}
          placeholder="Filter…"
          className="mb-1 h-8 text-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      ) : null}
      <div className="max-h-44 space-y-0.5 overflow-y-auto">
        {visible.map((o) => (
          <label key={o.id} className="flex items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50">
            <input
              type="checkbox"
              className="mt-1"
              disabled={disabled}
              checked={selected.includes(o.id)}
              onChange={(e) => onChange(e.target.checked ? [...selected, o.id] : selected.filter((id) => id !== o.id))}
            />
            <span className="min-w-0 text-slate-700">{render(o)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const EVENT_TEXT: Record<(typeof EVENT_KINDS)[number], string> = {
  created: 'Created',
  status: 'Status',
  work_status: 'Moved',
  effort: 'Effort',
  comment: 'Comment',
  assignment: 'Assigned',
  flag: 'Flag',
  edit: 'Updated',
};

const humanise = (value: string | null) => (value ? value.replace(/_/g, ' ') : '–');

/** Status history, effort updates and comments of one record, with a box to add a comment. */
export function History({
  projectId,
  entityType,
  entityId,
  events,
  lookups,
}: {
  projectId: string;
  entityType: EventEntity;
  entityId: string;
  events: DeliveryEvent[];
  lookups: Lookups;
}) {
  const [body, setBody] = useState('');
  const comment = useDeliveryOp(projectId, 'addComment');
  const mine = events.filter((e) => e.entityId === entityId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section aria-label="History and comments" className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <MessageSquare className="size-4 text-slate-400" /> History and comments
      </h3>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          comment.mutate({ entityType, entityId, body }, { onSuccess: () => setBody('') });
        }}
      >
        <Input aria-label="Comment" placeholder="Add a comment…" value={body} onChange={(e) => setBody(e.target.value)} />
        <Button type="submit" loading={comment.isPending} disabled={!body.trim()}>
          Comment
        </Button>
      </form>
      {comment.error ? <Alert tone="error">{errorMessage(comment.error)}</Alert> : null}
      <ol className="space-y-1.5 text-xs">
        {mine.map((e) => (
          <li key={e.id} className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
            <span className="font-medium text-slate-700">{lookups.memberName(e.actorId)}</span>{' '}
            <span className="text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>{' '}
            <span className="text-slate-500">· {EVENT_TEXT[e.kind]}</span>
            {e.kind === 'status' || e.kind === 'work_status' ? (
              <span className="text-slate-700">
                {' '}
                {humanise(e.fromValue)} → {humanise(e.toValue)}
              </span>
            ) : e.kind === 'assignment' ? (
              <span className="text-slate-700"> {lookups.memberName(e.toValue)}</span>
            ) : e.kind === 'flag' ? (
              <span className="text-slate-700"> {humanise(e.toValue)}</span>
            ) : null}
            {e.body ? <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{e.body}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export const hours = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${n} h`);
export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString() : '–';

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
