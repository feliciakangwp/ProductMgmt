import {
  activeItems,
  canDeliver,
  checkSprintStatusChange,
  SPRINT_STATUS_LABELS,
  sprintCapacity,
  sprintVelocity,
  type Sprint,
  type SprintItem,
  type SprintStatus,
  type Story,
} from '@productflow/domain';
import { CalendarRange, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { Alert, Badge, Button, Dialog, EmptyState, Field, IconButton, Input, Select, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useDelivery, useDeliveryOp, type Lookups } from './api';
import { DeliveryPage, formatDate, Loading, PriorityBadge, Section, WorkStatusBadge } from './shared';

const SPRINT_TONE: Record<SprintStatus, 'blue' | 'green' | 'slate' | 'amber'> = {
  planned: 'amber',
  active: 'blue',
  completed: 'green',
  cancelled: 'slate',
};

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Sprint Planning: sprints, their capacity and the backlog items allocated to them. */
export function SprintsPage() {
  const { projectId = '' } = useParams();
  const { role, snapshot, lookups, isPending, error } = useDelivery(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const canPlan = canDeliver(role, 'manageBacklog');
  const sprints = [...(snapshot?.sprints ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const selected = sprints.find((s) => s.id === selectedId) ?? sprints.find((s) => s.status === 'active') ?? sprints[0] ?? null;

  return (
    <DeliveryPage
      projectId={projectId}
      module="Sprint Planning"
      title="Sprint planning"
      description="Plan backlog items into sprints against the team's capacity."
      actions={
        canPlan ? (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New sprint
          </Button>
        ) : undefined
      }
    >
      <Loading isPending={isPending} error={error} />
      {snapshot && lookups ? (
        sprints.length === 0 ? (
          <EmptyState icon={<CalendarRange className="size-8" />} title="No sprints yet">
            Create a sprint, then plan backlog items into it.
          </EmptyState>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
            <nav aria-label="Sprints" className="space-y-1">
              {sprints.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-left text-sm',
                    s.id === selected?.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{s.name}</span>
                    <Badge tone={SPRINT_TONE[s.status]}>{SPRINT_STATUS_LABELS[s.status]}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    {formatDate(s.startDate)} – {formatDate(s.endDate)}
                  </p>
                </button>
              ))}
            </nav>
            {selected ? (
              <SprintDetail
                key={selected.id}
                projectId={projectId}
                sprint={selected}
                canPlan={canPlan}
                lookups={lookups}
                snapshot={snapshot}
              />
            ) : null}
          </div>
        )
      ) : null}
      {creating && snapshot ? (
        <SprintForm
          projectId={projectId}
          defaultCapacity={snapshot.settings.defaultSprintCapacityHours}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            setSelectedId(id);
          }}
        />
      ) : null}
    </DeliveryPage>
  );
}

function SprintForm({
  projectId,
  sprint,
  defaultCapacity,
  onClose,
  onSaved,
}: {
  projectId: string;
  sprint?: Sprint;
  defaultCapacity: number;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const start = today();
  const [value, setValue] = useState({
    name: sprint?.name ?? '',
    objective: sprint?.objective ?? '',
    startDate: sprint?.startDate ?? start,
    endDate: sprint?.endDate ?? plusDays(start, 13),
    capacityHours: sprint?.capacityHours ?? defaultCapacity,
    team: sprint?.team ?? '',
  });
  const create = useDeliveryOp(projectId, 'createSprint');
  const update = useDeliveryOp(projectId, 'updateSprint');
  const failed = create.error ?? update.error;
  return (
    <Dialog
      open
      onClose={onClose}
      title={sprint ? `Edit ${sprint.name}` : 'New sprint'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={create.isPending || update.isPending}
            disabled={!value.name.trim()}
            onClick={() =>
              sprint
                ? update.mutate({ sprintId: sprint.id, revision: sprint.revision, ...value }, { onSuccess: (s) => onSaved(s.id) })
                : create.mutate({ projectId, ...value }, { onSuccess: (s) => onSaved(s.id) })
            }
          >
            {sprint ? 'Save' : 'Create sprint'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sprint name" className="sm:col-span-2">
          {(id) => <Input id={id} value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} />}
        </Field>
        <Field label="Objective" className="sm:col-span-2">
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={value.objective}
              onChange={(e) => setValue({ ...value, objective: e.target.value })}
            />
          )}
        </Field>
        <Field label="Start date">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={value.startDate}
              onChange={(e) => setValue({ ...value, startDate: e.target.value })}
            />
          )}
        </Field>
        <Field label="End date">
          {(id) => (
            <Input id={id} type="date" value={value.endDate} onChange={(e) => setValue({ ...value, endDate: e.target.value })} />
          )}
        </Field>
        <Field label="Capacity (hours)">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              value={value.capacityHours}
              onChange={(e) => setValue({ ...value, capacityHours: Number(e.target.value) || 0 })}
            />
          )}
        </Field>
        <Field label="Team" hint="One sprint per team can be active at a time.">
          {(id) => <Input id={id} value={value.team} onChange={(e) => setValue({ ...value, team: e.target.value })} />}
        </Field>
      </div>
      {failed ? (
        <Alert tone="error" className="mt-3">
          {errorMessage(failed)}
        </Alert>
      ) : null}
    </Dialog>
  );
}

function SprintDetail({
  projectId,
  sprint,
  canPlan,
  lookups,
  snapshot,
}: {
  projectId: string;
  sprint: Sprint;
  canPlan: boolean;
  lookups: Lookups;
  snapshot: NonNullable<ReturnType<typeof useDelivery>['snapshot']>;
}) {
  const [editing, setEditing] = useState(false);
  const setStatus = useDeliveryOp(projectId, 'setSprintStatus');
  const add = useDeliveryOp(projectId, 'addToSprint');
  const updateItem = useDeliveryOp(projectId, 'updateSprintItem');
  const remove = useDeliveryOp(projectId, 'removeFromSprint');
  const failed = setStatus.error ?? add.error ?? updateItem.error ?? remove.error;
  const capacity = sprintCapacity(sprint, snapshot.sprintItems);
  const items = activeItems(snapshot.sprintItems, sprint.id);
  const storyById = new Map(snapshot.stories.map((s) => [s.id, s]));
  const open = sprint.status === 'planned' || sprint.status === 'active';
  const allocated = new Set(
    snapshot.sprintItems
      .filter(
        (i) =>
          i.removedAt === null &&
          snapshot.sprints.some((s) => s.id === i.sprintId && (s.status === 'planned' || s.status === 'active')),
      )
      .map((i) => i.storyId),
  );
  const candidates = snapshot.stories
    .filter((s) => s.status === 'in_backlog' && s.workStatus !== 'completed' && !allocated.has(s.id))
    .sort((a, b) => a.backlogRank - b.backlogRank);
  const inSprint = new Set(items.map((i) => i.storyId));
  const warnings = items.flatMap((i) => {
    const s = storyById.get(i.storyId);
    if (!s) return [];
    const waiting = s.dependsOnIds
      .map((id) => storyById.get(id))
      .filter((d) => d && d.workStatus !== 'completed' && !inSprint.has(d.id));
    return waiting.length
      ? [`${s.refCode} depends on ${waiting.map((d) => d!.refCode).join(', ')}, which is not completed or in this sprint.`]
      : [];
  });
  const others = snapshot.sprints.filter((s) => s.status === 'active');
  const transitions: { to: SprintStatus; label: string }[] =
    sprint.status === 'planned'
      ? [
          { to: 'active', label: 'Start sprint' },
          { to: 'cancelled', label: 'Cancel sprint' },
        ]
      : sprint.status === 'active'
        ? [
            { to: 'completed', label: 'Complete sprint' },
            { to: 'cancelled', label: 'Cancel sprint' },
          ]
        : [];
  const velocity = sprint.status !== 'planned' ? sprintVelocity(sprint, snapshot.sprintItems, snapshot.stories) : null;
  const pct = Math.min(100, capacity.utilisation ?? 0);

  return (
    <div className="space-y-4">
      <Section
        title={`${sprint.refCode} · ${sprint.name}`}
        actions={
          canPlan ? (
            <div className="flex flex-wrap gap-2">
              {open ? (
                <Button size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              ) : null}
              {transitions.map((t) => {
                const problem = checkSprintStatusChange(sprint, t.to, others, snapshot.settings.allowConcurrentSprints);
                return (
                  <Button
                    key={t.to}
                    size="sm"
                    variant={t.to === 'cancelled' ? 'danger' : 'primary'}
                    disabled={Boolean(problem)}
                    title={problem ?? undefined}
                    loading={setStatus.isPending && setStatus.variables?.status === t.to}
                    onClick={() => setStatus.mutate({ sprintId: sprint.id, revision: sprint.revision, status: t.to })}
                  >
                    {t.label}
                  </Button>
                );
              })}
            </div>
          ) : undefined
        }
      >
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
          <span>
            <Badge tone={SPRINT_TONE[sprint.status]}>{SPRINT_STATUS_LABELS[sprint.status]}</Badge>
          </span>
          <span>
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
          </span>
          {sprint.team ? <span>Team: {sprint.team}</span> : null}
        </div>
        {sprint.objective ? <p className="mt-2 text-sm text-slate-700">{sprint.objective}</p> : null}
        <div className="mt-4">
          <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-600">
            <span>
              Capacity <b>{capacity.capacityHours} h</b> · Allocated <b>{capacity.allocatedHours} h</b> · Remaining{' '}
              <b className={capacity.overCapacity ? 'text-red-700' : ''}>{capacity.remainingHours} h</b>
            </span>
            <span>Utilisation {capacity.utilisation === null ? '–' : `${capacity.utilisation}%`}</span>
          </div>
          <div
            className="mt-1 h-2 overflow-hidden rounded bg-slate-100"
            role="meter"
            aria-label="Sprint utilisation"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={capacity.utilisation ?? 0}
          >
            <div className={cn('h-full', capacity.overCapacity ? 'bg-red-500' : 'bg-brand-600')} style={{ width: `${pct}%` }} />
          </div>
          {capacity.overCapacity ? (
            <Alert tone="warning" className="mt-2">
              The sprint is over capacity by {Math.abs(capacity.remainingHours)} h. Remove items or increase capacity.
            </Alert>
          ) : null}
          {capacity.byDeveloper.length ? (
            <p className="mt-2 text-xs text-slate-500">
              By developer:{' '}
              {capacity.byDeveloper.map((d) => `${lookups.memberName(d.assigneeId)} ${d.allocatedHours} h`).join(' · ')}
            </p>
          ) : null}
        </div>
        {velocity ? (
          <p className="mt-3 text-xs text-slate-600">
            Committed {velocity.committedCount} stories ({velocity.committedPoints} pts, {velocity.committedHours} h). Completed
            in sprint {velocity.completedCount} ({velocity.completedPoints} pts, {velocity.completedHours} h)
            {velocity.completionRate !== null ? `, ${velocity.completionRate}% of the commitment` : ''}.
            {velocity.addedCompletedCount
              ? ` Also completed ${velocity.addedCompletedCount} added mid-sprint (not counted toward the commitment).`
              : ''}
          </p>
        ) : null}
      </Section>

      {failed ? <Alert tone="error">{errorMessage(failed)}</Alert> : null}
      {warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}

      <Section
        title={`Planned items (${items.length})`}
        actions={
          canPlan && open && candidates.length ? (
            <Select
              aria-label="Add a backlog item"
              className="h-8 w-72 text-xs"
              value=""
              onChange={(e) => e.target.value && add.mutate({ sprintId: sprint.id, storyId: e.target.value })}
            >
              <option value="">Add from backlog…</option>
              {candidates.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.refCode} {s.title} ({s.estimateHours ?? '?'} h)
                </option>
              ))}
            </Select>
          ) : undefined
        }
      >
        {items.length === 0 ? <p className="text-sm text-slate-500">Nothing planned yet.</p> : null}
        {items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-2">Story</th>
                  <th className="py-1 pr-2">Planned h</th>
                  <th className="py-1 pr-2">Developer</th>
                  <th className="py-1 pr-2">Planned start</th>
                  <th className="py-1 pr-2">Planned completion</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    story={storyById.get(item.storyId)}
                    lookups={lookups}
                    editable={canPlan && open}
                    onSave={(patch) => updateItem.mutate({ itemId: item.id, ...patch })}
                    onRemove={() => remove.mutate({ itemId: item.id })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>
      {editing ? (
        <SprintForm
          projectId={projectId}
          sprint={sprint}
          defaultCapacity={sprint.capacityHours}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

function ItemRow({
  item,
  story,
  lookups,
  editable,
  onSave,
  onRemove,
}: {
  item: SprintItem;
  story: Story | undefined;
  lookups: Lookups;
  editable: boolean;
  onSave: (patch: {
    plannedHours: number;
    assigneeId: string | null;
    plannedStart: string | null;
    plannedEnd: string | null;
  }) => void;
  onRemove: () => void;
}) {
  const current = {
    plannedHours: item.plannedHours,
    assigneeId: item.assigneeId,
    plannedStart: item.plannedStart,
    plannedEnd: item.plannedEnd,
  };
  const save = (patch: Partial<typeof current>) => onSave({ ...current, ...patch });
  return (
    <tr>
      <td className="py-1.5 pr-2">
        <span className="font-mono text-xs text-slate-500">{story?.refCode}</span> {story?.title}
        <div className="mt-0.5 flex gap-1">
          {story ? <WorkStatusBadge status={story.workStatus} /> : null}
          {story ? <PriorityBadge priority={story.priority} /> : null}
          {!item.committed ? <Badge tone="amber">Added after start</Badge> : null}
        </div>
      </td>
      <td className="py-1.5 pr-2">
        <Input
          aria-label={`Planned hours for ${story?.refCode}`}
          type="number"
          min={0}
          className="h-8 w-20 text-xs"
          disabled={!editable}
          defaultValue={item.plannedHours}
          onBlur={(e) => Number(e.target.value) !== item.plannedHours && save({ plannedHours: Number(e.target.value) || 0 })}
        />
      </td>
      <td className="py-1.5 pr-2">
        <Select
          aria-label={`Developer for ${story?.refCode}`}
          className="h-8 w-36 text-xs"
          disabled={!editable}
          value={item.assigneeId ?? ''}
          onChange={(e) => save({ assigneeId: e.target.value || null })}
        >
          <option value="">Unassigned</option>
          {lookups.developers.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </Select>
      </td>
      <td className="py-1.5 pr-2">
        <Input
          aria-label={`Planned start for ${story?.refCode}`}
          type="date"
          className="h-8 w-36 text-xs"
          disabled={!editable}
          value={item.plannedStart ?? ''}
          onChange={(e) => save({ plannedStart: e.target.value || null })}
        />
      </td>
      <td className="py-1.5 pr-2">
        <Input
          aria-label={`Planned completion for ${story?.refCode}`}
          type="date"
          className="h-8 w-36 text-xs"
          disabled={!editable}
          value={item.plannedEnd ?? ''}
          onChange={(e) => save({ plannedEnd: e.target.value || null })}
        />
      </td>
      <td className="py-1.5">
        {editable ? (
          <IconButton label={`Remove ${story?.refCode} from sprint`} icon={<Trash2 className="size-3.5" />} onClick={onRemove} />
        ) : null}
      </td>
    </tr>
  );
}
