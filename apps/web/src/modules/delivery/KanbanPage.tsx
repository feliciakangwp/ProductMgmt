import {
  canDeliver,
  checkWorkMove,
  STORY_TYPE_LABELS,
  WORK_STATUS_LABELS,
  WORK_STATUSES,
  type DeliverySnapshot,
  type ProjectRole,
  type Sprint,
  type Story,
  type WorkStatus,
} from '@productflow/domain';
import { Ban, Columns3 } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { Alert, Badge, Button, Dialog, EmptyState, Field, Input, Select, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useDelivery, useDeliveryOp, type Lookups } from './api';
import { DeliveryPage, History, hours, Loading, PriorityBadge, WorkStatusBadge } from './shared';

function sprintFor(snapshot: DeliverySnapshot, storyId: string): Sprint | null {
  const items = snapshot.sprintItems.filter((i) => i.storyId === storyId && i.removedAt === null);
  for (const status of ['active', 'planned'] as const) {
    for (const i of items) {
      const s = snapshot.sprints.find((x) => x.id === i.sprintId && x.status === status);
      if (s) return s;
    }
  }
  return null;
}

function moveProblem(story: Story, to: WorkStatus, role: ProjectRole | null, snapshot: DeliverySnapshot) {
  return checkWorkMove(story, to, role, {
    settings: snapshot.settings,
    sprint: sprintFor(snapshot, story.id),
    dependencies: snapshot.stories.filter((s) => story.dependsOnIds.includes(s.id)),
  });
}

/** Development Kanban: six columns from To-do to Completed, following the workflow rules. */
export function KanbanPage() {
  const { projectId = '' } = useParams();
  const { role, snapshot, lookups, isPending, error } = useDelivery(projectId);
  const move = useDeliveryOp(projectId, 'moveStory');
  const [sprintFilter, setSprintFilter] = useState<string>('auto');
  const [developer, setDeveloper] = useState('all');
  const [dragging, setDragging] = useState<Story | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  if (!snapshot || !lookups) {
    return (
      <DeliveryPage projectId={projectId} module="Development Kanban" title="Development board" description="">
        <Loading isPending={isPending} error={error} />
      </DeliveryPage>
    );
  }
  const active = snapshot.sprints.find((s) => s.status === 'active');
  const sprintId = sprintFilter === 'auto' ? (active?.id ?? 'all') : sprintFilter;
  const cards = snapshot.stories
    .filter((s) => s.status === 'in_backlog')
    .filter((s) => {
      if (sprintId === 'all') return true;
      const sp = sprintFor(snapshot, s.id);
      return sprintId === 'none' ? !sp : sp?.id === sprintId;
    })
    .filter((s) => developer === 'all' || (developer === 'none' ? !s.assigneeId : s.assigneeId === developer))
    .sort((a, b) => a.backlogRank - b.backlogRank);
  const openStory = open ? (snapshot.stories.find((s) => s.id === open) ?? null) : null;

  return (
    <DeliveryPage
      projectId={projectId}
      module="Development Kanban"
      title="Development board"
      description={`Drag cards between columns, or open a card to move it.${snapshot.settings.strictWorkflow ? ' Cards move forward one column at a time.' : ''}`}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Select aria-label="Sprint" className="w-52" value={sprintId} onChange={(e) => setSprintFilter(e.target.value)}>
          <option value="all">All backlog items</option>
          <option value="none">Not in a sprint</option>
          {snapshot.sprints
            .filter((s) => s.status === 'active' || s.status === 'planned')
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.status === 'active' ? ' (active)' : ''}
              </option>
            ))}
        </Select>
        <Select aria-label="Developer" className="w-48" value={developer} onChange={(e) => setDeveloper(e.target.value)}>
          <option value="all">All developers</option>
          <option value="none">Unassigned</option>
          {lookups.developers.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </Select>
      </div>
      {move.error ? (
        <Alert tone="error" className="mb-4">
          {errorMessage(move.error)}
        </Alert>
      ) : null}
      {snapshot.stories.every((s) => s.status !== 'in_backlog') ? (
        <EmptyState icon={<Columns3 className="size-8" />} title="Nothing on the board yet">
          Stories appear here once they are added to the backlog.
        </EmptyState>
      ) : (
        <div className="grid min-w-0 grid-flow-col gap-3 overflow-x-auto pb-4" style={{ gridAutoColumns: 'minmax(170px, 1fr)' }}>
          {WORK_STATUSES.map((status) => {
            const column = cards.filter((c) => c.workStatus === status);
            const allowed = dragging ? dragging.workStatus !== status && !moveProblem(dragging, status, role, snapshot) : false;
            return (
              <section
                key={status}
                aria-label={WORK_STATUS_LABELS[status]}
                className={cn(
                  'flex min-h-64 flex-col rounded-lg border bg-slate-50 p-2',
                  dragging && allowed ? 'border-brand-400 bg-brand-50' : 'border-slate-200',
                  dragging && !allowed && dragging.workStatus !== status ? 'opacity-60' : '',
                )}
                onDragOver={(e) => {
                  if (allowed) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging && allowed) move.mutate({ storyId: dragging.id, revision: dragging.revision, to: status });
                  setDragging(null);
                }}
              >
                <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-slate-600">
                  {WORK_STATUS_LABELS[status]}
                  <span className="rounded bg-white px-1.5 text-slate-400">{column.length}</span>
                </h2>
                <ul className="space-y-2">
                  {column.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        draggable={canDeliver(role, 'updateWork')}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', s.id);
                          setDragging(s);
                        }}
                        onDragEnd={() => setDragging(null)}
                        onClick={() => setOpen(s.id)}
                        aria-label={`${s.refCode} ${s.title}`}
                        className={cn(
                          'w-full rounded-md border bg-white p-2 text-left text-xs shadow-sm hover:border-brand-500',
                          s.blocked ? 'border-red-300' : 'border-slate-200',
                        )}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-slate-500">{s.refCode}</span>
                          <PriorityBadge priority={s.priority} />
                        </div>
                        <p className="mt-1 text-sm font-medium text-slate-900">{s.title}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <Badge>{STORY_TYPE_LABELS[s.storyType]}</Badge>
                          {s.blocked ? (
                            <Badge tone="red" title={s.blockedReason}>
                              <Ban className="size-3" /> Blocked
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1.5 text-slate-500">
                          {lookups.memberName(s.assigneeId)} · {hours(s.estimateHours)} est · {hours(s.remainingHours)} left
                        </p>
                        <p className="text-slate-400">{sprintFor(snapshot, s.id)?.name ?? 'No sprint'}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {openStory ? (
        <WorkCardDialog
          projectId={projectId}
          story={openStory}
          role={role}
          snapshot={snapshot}
          lookups={lookups}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </DeliveryPage>
  );
}

function WorkCardDialog({
  projectId,
  story,
  role,
  snapshot,
  lookups,
  onClose,
}: {
  projectId: string;
  story: Story;
  role: ProjectRole | null;
  snapshot: DeliverySnapshot;
  lookups: Lookups;
  onClose: () => void;
}) {
  const move = useDeliveryOp(projectId, 'moveStory');
  const effort = useDeliveryOp(projectId, 'updateEffort');
  const block = useDeliveryOp(projectId, 'setBlocked');
  const backlog = useDeliveryOp(projectId, 'updateBacklog');
  const [remaining, setRemaining] = useState(String(story.remainingHours ?? ''));
  const [actual, setActual] = useState(String(story.actualHours));
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const canWork = canDeliver(role, 'updateWork');
  const failed = move.error ?? effort.error ?? block.error ?? backlog.error;

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={`${story.refCode} ${story.title}`}
      description={<WorkStatusBadge status={story.workStatus} />}
    >
      <div className="space-y-4">
        {failed ? <Alert tone="error">{errorMessage(failed)}</Alert> : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-xs text-slate-500">Original estimate</dt>
          <dd>{hours(story.originalEstimateHours)}</dd>
          <dt className="text-xs text-slate-500">Current estimate</dt>
          <dd>{hours(story.estimateHours)}</dd>
          <dt className="text-xs text-slate-500">Remaining</dt>
          <dd>{hours(story.remainingHours)}</dd>
          <dt className="text-xs text-slate-500">Actual</dt>
          <dd>{hours(story.actualHours)}</dd>
          <dt className="text-xs text-slate-500">Sprint</dt>
          <dd>{sprintFor(snapshot, story.id)?.name ?? '–'}</dd>
          <dt className="text-xs text-slate-500">Completed</dt>
          <dd>{story.completedAt ? new Date(story.completedAt).toLocaleDateString() : '–'}</dd>
        </dl>
        {canWork ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Move to">
              {(id) => (
                <Select
                  id={id}
                  value={story.workStatus}
                  onChange={(e) => move.mutate({ storyId: story.id, revision: story.revision, to: e.target.value as WorkStatus })}
                >
                  {WORK_STATUSES.map((w) => {
                    const problem = w === story.workStatus ? null : moveProblem(story, w, role, snapshot);
                    return (
                      <option key={w} value={w} disabled={Boolean(problem)} title={problem ?? undefined}>
                        {WORK_STATUS_LABELS[w]}
                        {problem ? ' (not allowed now)' : ''}
                      </option>
                    );
                  })}
                </Select>
              )}
            </Field>
            <Field label="Developer">
              {(id) => (
                <Select
                  id={id}
                  value={story.assigneeId ?? ''}
                  onChange={(e) =>
                    backlog.mutate({ storyId: story.id, revision: story.revision, patch: { assigneeId: e.target.value || null } })
                  }
                >
                  <option value="">Unassigned</option>
                  {lookups.developers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        ) : null}
        {canWork ? (
          <form
            className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              effort.mutate(
                {
                  storyId: story.id,
                  revision: story.revision,
                  remainingHours: remaining === '' ? undefined : Number(remaining),
                  actualHours: actual === '' ? undefined : Number(actual),
                  note,
                },
                { onSuccess: () => setNote('') },
              );
            }}
          >
            <Field label="Remaining hours">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  step="0.5"
                  className="w-28"
                  value={remaining}
                  onChange={(e) => setRemaining(e.target.value)}
                />
              )}
            </Field>
            <Field label="Actual hours to date">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  step="0.5"
                  className="w-28"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                />
              )}
            </Field>
            <Field label="Note" className="min-w-40 flex-1">
              {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <Button type="submit" loading={effort.isPending}>
              Update effort
            </Button>
          </form>
        ) : null}
        {canWork ? (
          story.blocked ? (
            <Alert
              tone="error"
              title="Blocked"
              action={
                <Button
                  size="sm"
                  loading={block.isPending}
                  onClick={() => block.mutate({ storyId: story.id, revision: story.revision, blocked: false })}
                >
                  Unblock
                </Button>
              }
            >
              {story.blockedReason}
            </Alert>
          ) : (
            <div className="flex items-end gap-2">
              <Field label="Blocked by" className="flex-1">
                {(id) => <Textarea id={id} rows={1} value={reason} onChange={(e) => setReason(e.target.value)} />}
              </Field>
              <Button
                icon={<Ban className="size-4" />}
                disabled={!reason.trim()}
                loading={block.isPending}
                onClick={() => block.mutate({ storyId: story.id, revision: story.revision, blocked: true, reason })}
              >
                Mark blocked
              </Button>
            </div>
          )
        ) : null}
        <History projectId={projectId} entityType="story" entityId={story.id} events={snapshot.events} lookups={lookups} />
      </div>
    </Dialog>
  );
}
