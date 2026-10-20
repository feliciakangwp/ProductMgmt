import { canDeliver, PRIORITIES, PRIORITY_LABELS, STORY_TYPE_LABELS, type Priority, type Story } from '@productflow/domain';
import { ArrowDown, ArrowUp, ListTodo } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { Alert, Button, EmptyState, IconButton, Input, Select } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useDelivery, useDeliveryOp } from './api';
import { DeliveryPage, Loading, WorkStatusBadge } from './shared';
import { StoryDialog } from './StoryDialog';

/** One number cell that saves when it loses focus. */
function NumberCell({
  label,
  value,
  disabled,
  onSave,
  min = 0,
  max,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onSave: (v: number | null) => void;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setText(value === null ? '' : String(value));
  }
  return (
    <Input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step="0.5"
      className="h-8 w-20 text-xs"
      disabled={disabled}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = text.trim() === '' ? null : Number(text);
        if (next !== value && (next === null || !Number.isNaN(next))) onSave(next);
      }}
    />
  );
}

/** Product Backlog: approved stories, prioritised, estimated, assigned and planned into sprints. */
export function BacklogPage() {
  const { projectId = '' } = useParams();
  const { role, snapshot, context, lookups, isPending, error } = useDelivery(projectId);
  const update = useDeliveryOp(projectId, 'updateBacklog');
  const reorder = useDeliveryOp(projectId, 'reorderBacklog');
  const addToBacklog = useDeliveryOp(projectId, 'setStoryStatus');
  const addToSprint = useDeliveryOp(projectId, 'addToSprint');
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<Priority | 'all'>('all');
  const [scheduled, setScheduled] = useState<'all' | 'unscheduled' | 'scheduled'>('all');
  const [assignee, setAssignee] = useState('all');
  const [open, setOpen] = useState<Story | null>(null);
  const plan = canDeliver(role, 'manageBacklog');
  const estimate = canDeliver(role, 'updateWork');
  const opError = update.error ?? reorder.error ?? addToBacklog.error ?? addToSprint.error;

  if (!snapshot || !lookups || !context) {
    return (
      <DeliveryPage projectId={projectId} module="Product Backlog" title="Product backlog" description="">
        <Loading isPending={isPending} error={error} />
      </DeliveryPage>
    );
  }

  const openSprints = snapshot.sprints.filter((s) => s.status === 'planned' || s.status === 'active');
  const sprintOf = (storyId: string) =>
    snapshot.sprintItems
      .filter((i) => i.storyId === storyId && i.removedAt === null)
      .map((i) => openSprints.find((s) => s.id === i.sprintId))
      .find(Boolean) ?? null;
  const backlog = snapshot.stories.filter((s) => s.status === 'in_backlog').sort((a, b) => a.backlogRank - b.backlogRank);
  const approved = snapshot.stories.filter((s) => s.status === 'approved');
  const shown = backlog.filter(
    (s) =>
      (!search || `${s.refCode} ${s.title}`.toLowerCase().includes(search.toLowerCase())) &&
      (priority === 'all' || s.priority === priority) &&
      (assignee === 'all' || (assignee === 'none' ? !s.assigneeId : s.assigneeId === assignee)) &&
      (scheduled === 'all' || (scheduled === 'scheduled') === Boolean(sprintOf(s.id))),
  );
  const filtered = shown.length !== backlog.length;
  const move = (story: Story, d: number) => {
    const order = backlog.map((s) => s.id);
    const i = order.indexOf(story.id);
    [order[i], order[i + d]] = [order[i + d]!, order[i]!];
    reorder.mutate({ projectId, storyIds: order });
  };
  const patch = (s: Story, p: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate({ storyId: s.id, revision: s.revision, patch: p });

  return (
    <DeliveryPage
      projectId={projectId}
      module="Product Backlog"
      title="Product backlog"
      description="Approved stories in priority order. A story stays in the backlog when it is planned into a sprint."
    >
      {opError ? (
        <Alert tone="error" className="mb-4">
          {errorMessage(opError)}
        </Alert>
      ) : null}
      {approved.length > 0 ? (
        <Alert
          tone="info"
          title={`${approved.length} approved stor${approved.length === 1 ? 'y is' : 'ies are'} not in the backlog yet`}
          className="mb-4"
        >
          <ul className="mt-1 space-y-1">
            {approved.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="font-mono text-xs">{s.refCode}</span> {s.title}
                {plan ? (
                  <Button
                    size="sm"
                    loading={addToBacklog.isPending && addToBacklog.variables?.storyId === s.id}
                    onClick={() => addToBacklog.mutate({ storyId: s.id, revision: s.revision, status: 'in_backlog' })}
                  >
                    Add to backlog
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          aria-label="Search backlog"
          placeholder="Search…"
          className="w-56"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          aria-label="Priority filter"
          className="w-40"
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority | 'all')}
        >
          <option value="all">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </Select>
        <Select aria-label="Assignee filter" className="w-44" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="all">Anyone</option>
          <option value="none">Unassigned</option>
          {lookups.developers.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Sprint filter"
          className="w-44"
          value={scheduled}
          onChange={(e) => setScheduled(e.target.value as typeof scheduled)}
        >
          <option value="all">Scheduled or not</option>
          <option value="unscheduled">Unscheduled</option>
          <option value="scheduled">In a sprint</option>
        </Select>
      </div>
      {backlog.length === 0 ? (
        <EmptyState icon={<ListTodo className="size-8" />} title="The backlog is empty">
          Approved stories appear here once a Product Owner adds them to the backlog.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Story</th>
                <th className="px-2 py-2">Priority</th>
                <th className="px-2 py-2">Value</th>
                <th className="px-2 py-2">Points</th>
                <th className="px-2 py-2">Estimate (h)</th>
                <th className="px-2 py-2">Developer</th>
                <th className="px-2 py-2">Sprint</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((s) => {
                const i = backlog.indexOf(s);
                const sprint = sprintOf(s.id);
                const deps = snapshot.stories.filter((d) => s.dependsOnIds.includes(d.id) && d.workStatus !== 'completed');
                return (
                  <tr key={s.id}>
                    <td className="px-2 py-2 text-xs text-slate-500">
                      <div className="flex items-center">
                        {s.backlogRank}
                        {plan && !filtered ? (
                          <>
                            <IconButton
                              label={`Move ${s.refCode} up`}
                              icon={<ArrowUp className="size-3.5" />}
                              disabled={i === 0 || reorder.isPending}
                              onClick={() => move(s, -1)}
                            />
                            <IconButton
                              label={`Move ${s.refCode} down`}
                              icon={<ArrowDown className="size-3.5" />}
                              disabled={i === backlog.length - 1 || reorder.isPending}
                              onClick={() => move(s, 1)}
                            />
                          </>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <button type="button" className="text-left" onClick={() => setOpen(s)}>
                        <span className="font-mono text-xs text-slate-500">{s.refCode}</span>{' '}
                        <span className="font-medium hover:text-brand-700">{s.title}</span>
                      </button>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        {STORY_TYPE_LABELS[s.storyType]} <WorkStatusBadge status={s.workStatus} />
                        {deps.length ? (
                          <span className="text-amber-700">Waits for {deps.map((d) => d.refCode).join(', ')}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        aria-label={`Priority of ${s.refCode}`}
                        className="h-8 w-28 text-xs"
                        disabled={!plan || update.isPending}
                        value={s.priority}
                        onChange={(e) => patch(s, { priority: e.target.value as Priority })}
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {PRIORITY_LABELS[p]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      <NumberCell
                        label={`Business value of ${s.refCode}`}
                        value={s.businessValue}
                        min={1}
                        max={10}
                        disabled={!plan || update.isPending}
                        onSave={(v) => patch(s, { businessValue: v === null ? null : Math.round(v) })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <NumberCell
                        label={`Story points of ${s.refCode}`}
                        value={s.storyPoints}
                        disabled={!estimate || update.isPending}
                        onSave={(v) => patch(s, { storyPoints: v })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <NumberCell
                        label={`Estimate of ${s.refCode}`}
                        value={s.estimateHours}
                        disabled={!estimate || update.isPending}
                        onSave={(v) => patch(s, { estimateHours: v })}
                      />
                      {s.originalEstimateHours !== null && s.originalEstimateHours !== s.estimateHours ? (
                        <p className="mt-0.5 text-[11px] text-slate-400">Original {s.originalEstimateHours} h</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        aria-label={`Developer for ${s.refCode}`}
                        className="h-8 w-36 text-xs"
                        disabled={!estimate || update.isPending}
                        value={s.assigneeId ?? ''}
                        onChange={(e) => patch(s, { assigneeId: e.target.value || null })}
                      >
                        <option value="">Unassigned</option>
                        {lookups.developers.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.displayName}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {sprint ? (
                        sprint.name
                      ) : plan && s.workStatus !== 'completed' && openSprints.length ? (
                        <Select
                          aria-label={`Plan ${s.refCode} into a sprint`}
                          className="h-8 w-36 text-xs"
                          value=""
                          onChange={(e) => e.target.value && addToSprint.mutate({ sprintId: e.target.value, storyId: s.id })}
                        >
                          <option value="">Unscheduled</option>
                          {openSprints.map((sp) => (
                            <option key={sp.id} value={sp.id}>
                              Add to {sp.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-slate-400">{s.workStatus === 'completed' ? 'Done' : 'Unscheduled'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered && plan ? (
            <p className="px-3 py-2 text-xs text-slate-400">Clear the filters to reorder the backlog.</p>
          ) : null}
        </div>
      )}
      {open ? (
        <StoryDialog
          projectId={projectId}
          story={open}
          role={role}
          snapshot={snapshot}
          context={context}
          lookups={lookups}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </DeliveryPage>
  );
}
