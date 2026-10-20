import {
  defectSummary,
  developerWorkload,
  effortTotals,
  flowMetrics,
  sprintBurndown,
  sprintCapacity,
  sprintVelocity,
  UAT_STATUS_LABELS,
  uatSummary,
  WORK_STATUS_LABELS,
  WORK_STATUSES,
  activeItems,
  type Sprint,
  type UatStatus,
} from '@productflow/domain';
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState, Select } from '../../components/ui';
import { useDelivery } from './api';
import { DeliveryPage, formatDate, Loading } from './shared';

// Validated reference palette (see the dataviz guidance): categorical slots in fixed order, status colours reserved for state.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'];
const GRID = '#e7e5e4';
const AXIS = { fontSize: 11, fill: '#52514e' };
const UAT_COLOR: Record<UatStatus, string> = {
  not_ready: '#a8a29e',
  ready: '#2a78d6',
  in_progress: '#6250d6',
  passed: '#0ca30c',
  failed: '#d03b3b',
  blocked: '#fab219',
};

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

/** A chart card with its data available as a table, so nothing depends on colour or hover alone. */
function ChartCard({
  title,
  description,
  children,
  table,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  table: { head: string[]; rows: (string | number)[][] };
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-label={title}>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {description ? <p className="text-xs text-slate-500">{description}</p> : null}
      <div className="mt-3 h-56">{children}</div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-slate-500">Show data table</summary>
        <table className="mt-1 w-full">
          <thead>
            <tr className="text-left text-slate-500">
              {table.head.map((h) => (
                <th key={h} className="py-0.5 pr-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="py-0.5 pr-2 tabular-nums">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

const fmt = (n: number | null, unit = '') => (n === null ? '–' : `${n}${unit}`);

/** Delivery Dashboard: sprint and quality metrics computed only from stored delivery records. */
export function DashboardPage() {
  const { projectId = '' } = useParams();
  const { snapshot, lookups, isPending, error } = useDelivery(projectId);
  const [sprintId, setSprintId] = useState<string | null>(null);

  if (!snapshot || !lookups) {
    return (
      <DeliveryPage projectId={projectId} module="Delivery Dashboard" title="Delivery dashboard" description="">
        <Loading isPending={isPending} error={error} />
      </DeliveryPage>
    );
  }
  const now = new Date().toISOString();
  const sprints = [...snapshot.sprints]
    .filter((s) => s.status !== 'cancelled')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const sprint: Sprint | undefined =
    sprints.find((s) => s.id === sprintId) ?? sprints.find((s) => s.status === 'active') ?? sprints[sprints.length - 1];
  const storyById = new Map(snapshot.stories.map((s) => [s.id, s]));
  const sprintStories = sprint
    ? activeItems(snapshot.sprintItems, sprint.id)
        .map((i) => storyById.get(i.storyId)!)
        .filter(Boolean)
    : [];
  const velocity = sprint && sprint.status !== 'planned' ? sprintVelocity(sprint, snapshot.sprintItems, snapshot.stories) : null;
  const capacity = sprint ? sprintCapacity(sprint, snapshot.sprintItems) : null;
  const effort = effortTotals(sprintStories);
  const flow = flowMetrics(snapshot.stories, now);
  const defects = defectSummary(snapshot.defects);
  const uat = uatSummary(snapshot.scenarios, snapshot.stories, snapshot.executions);
  const history = sprints
    .filter((s) => s.status !== 'planned')
    .map((s) => ({ name: s.name, ...sprintVelocity(s, snapshot.sprintItems, snapshot.stories) }));
  const burndown = sprint ? sprintBurndown(sprint, snapshot.sprintItems, snapshot.stories, snapshot.events, now) : [];
  const workload = sprint
    ? developerWorkload(sprint, snapshot.sprintItems, snapshot.stories).map((w) => ({
        name: lookups.memberName(w.assigneeId),
        ...w,
      }))
    : [];
  const distribution = WORK_STATUSES.map((w) => ({ name: WORK_STATUS_LABELS[w], count: flow.statusCounts[w] }));
  const uatRows = (Object.keys(uat.counts) as UatStatus[]).map((k) => ({
    key: k,
    name: UAT_STATUS_LABELS[k],
    count: uat.counts[k],
  }));

  return (
    <DeliveryPage
      projectId={projectId}
      module="Delivery Dashboard"
      title="Delivery dashboard"
      description="Every figure is computed from stored stories, sprints, tests and defects. Nothing is estimated."
      actions={
        sprints.length ? (
          <Select aria-label="Sprint" className="w-56" value={sprint?.id ?? ''} onChange={(e) => setSprintId(e.target.value)}>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.status})
              </option>
            ))}
          </Select>
        ) : undefined
      }
    >
      {snapshot.stories.length === 0 ? (
        <EmptyState title="No delivery data yet">
          Metrics appear once stories are in the backlog and sprints are planned.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Tile
              label="Sprint"
              value={sprint?.name ?? '–'}
              sub={sprint ? `${formatDate(sprint.startDate)} – ${formatDate(sprint.endDate)}` : 'No sprint planned'}
            />
            <Tile
              label="Stories in sprint"
              value={sprintStories.length}
              sub={`${sprintStories.filter((s) => s.workStatus === 'completed').length} completed`}
            />
            <Tile
              label="Planned effort"
              value={`${capacity?.allocatedHours ?? 0} h`}
              sub={`of ${capacity?.capacityHours ?? 0} h capacity`}
            />
            <Tile label="Actual effort" value={`${effort.actual} h`} sub={`${effort.remaining} h remaining`} />
            <Tile
              label="Velocity (points)"
              value={fmt(velocity?.completedPoints ?? null)}
              sub={velocity ? `of ${velocity.committedPoints} committed` : 'Sprint not started'}
            />
            <Tile
              label="Velocity (hours)"
              value={fmt(velocity?.completedHours ?? null, ' h')}
              sub={velocity ? `of ${velocity.committedHours} h committed` : 'Sprint not started'}
            />
            <Tile
              label="Completion rate"
              value={fmt(velocity?.completionRate ?? null, '%')}
              sub="Committed stories done in the sprint"
            />
            <Tile label="Work in progress" value={flow.workInProgress} sub="In development to In testing" />
            <Tile label="Average cycle time" value={fmt(flow.averageCycleDays, ' d')} sub="Development start to completion" />
            <Tile label="Blocked stories" value={flow.blocked.length} />
            <Tile
              label="Open defects"
              value={defects.open}
              sub={`${defects.bySeverity.critical} critical, ${defects.bySeverity.major} major`}
            />
            <Tile
              label="UAT pass rate"
              value={fmt(uat.passRate, '%')}
              sub={`${uat.counts.passed} passed, ${uat.counts.failed} failed`}
            />
          </div>
          {velocity && velocity.addedCompletedCount > 0 ? (
            <p className="text-xs text-slate-500">
              {velocity.addedCompletedCount} stor{velocity.addedCompletedCount === 1 ? 'y' : 'ies'} added after the sprint started
              and completed ({velocity.addedCompletedPoints} pts) are not counted toward the commitment.
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title={sprint ? `Burndown: ${sprint.name}` : 'Burndown'}
              description="Remaining hours of committed work at the end of each day, from recorded effort updates."
              table={{
                head: ['Date', 'Ideal h', 'Remaining h'],
                rows: burndown.map((p) => [p.date, p.ideal, p.remaining ?? '–']),
              }}
            >
              <ResponsiveContainer>
                <LineChart data={burndown} margin={{ top: 4, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="date" tick={AXIS} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={AXIS} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    isAnimationActive={false}
                    type="linear"
                    dataKey="ideal"
                    name="Ideal"
                    stroke="#a8a29e"
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    isAnimationActive={false}
                    type="linear"
                    dataKey="remaining"
                    name="Remaining"
                    stroke={SERIES[0]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Velocity: story points"
              description="Committed points and points completed within each sprint."
              table={{
                head: ['Sprint', 'Committed pts', 'Completed pts'],
                rows: history.map((h) => [h.name, h.committedPoints, h.completedPoints]),
              }}
            >
              <ResponsiveContainer>
                <BarChart data={history} margin={{ top: 4, right: 12, bottom: 0, left: -12 }} barGap={2}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" tick={AXIS} />
                  <YAxis tick={AXIS} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    isAnimationActive={false}
                    dataKey="committedPoints"
                    name="Committed"
                    fill={SERIES[0]}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    isAnimationActive={false}
                    dataKey="completedPoints"
                    name="Completed"
                    fill={SERIES[1]}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Velocity: estimated hours"
              description="Reported separately from points: estimated hours of committed and completed work."
              table={{
                head: ['Sprint', 'Committed h', 'Completed h'],
                rows: history.map((h) => [h.name, h.committedHours, h.completedHours]),
              }}
            >
              <ResponsiveContainer>
                <BarChart data={history} margin={{ top: 4, right: 12, bottom: 0, left: -12 }} barGap={2}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" tick={AXIS} />
                  <YAxis tick={AXIS} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    isAnimationActive={false}
                    dataKey="committedHours"
                    name="Committed"
                    fill={SERIES[0]}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    isAnimationActive={false}
                    dataKey="completedHours"
                    name="Completed"
                    fill={SERIES[1]}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Status distribution"
              description="Backlog stories by Kanban column."
              table={{ head: ['Column', 'Stories'], rows: distribution.map((d) => [d.name, d.count]) }}
            >
              <ResponsiveContainer>
                <BarChart data={distribution} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 24 }}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={AXIS} width={110} />
                  <Tooltip />
                  <Bar
                    isAnimationActive={false}
                    dataKey="count"
                    name="Stories"
                    fill={SERIES[0]}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={18}
                    label={{ position: 'right', fontSize: 11, fill: '#52514e' }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Developer workload"
              description={sprint ? `Planned and remaining hours in ${sprint.name}.` : 'Planned and remaining hours.'}
              table={{
                head: ['Developer', 'Planned h', 'Remaining h', 'Open stories'],
                rows: workload.map((w) => [w.name, w.plannedHours, w.remainingHours, w.openStories]),
              }}
            >
              <ResponsiveContainer>
                <BarChart data={workload} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 24 }} barGap={2}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS} />
                  <YAxis type="category" dataKey="name" tick={AXIS} width={110} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    isAnimationActive={false}
                    dataKey="plannedHours"
                    name="Planned"
                    fill={SERIES[0]}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={14}
                  />
                  <Bar
                    isAnimationActive={false}
                    dataKey="remainingHours"
                    name="Remaining"
                    fill={SERIES[1]}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={14}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="UAT progress"
              description="Business scenarios by their latest test status."
              table={{ head: ['Status', 'Scenarios'], rows: uatRows.map((r) => [r.name, r.count]) }}
            >
              <ResponsiveContainer>
                <BarChart data={uatRows} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 24 }}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={AXIS} width={130} />
                  <Tooltip />
                  <Bar
                    isAnimationActive={false}
                    dataKey="count"
                    name="Scenarios"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={18}
                    label={{ position: 'right', fontSize: 11, fill: '#52514e' }}
                  >
                    {uatRows.map((r) => (
                      <Cell key={r.key} fill={UAT_COLOR[r.key]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Story ageing</h2>
              <p className="text-xs text-slate-500">Stories in progress, oldest first: days since development started.</p>
              {flow.ageing.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nothing in progress.</p> : null}
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {flow.ageing.map((a) => (
                  <li key={a.storyId} className="flex justify-between gap-2 py-1">
                    <span>
                      <span className="font-mono text-xs text-slate-500">{a.refCode}</span> {a.title}
                    </span>
                    <span className="text-xs text-slate-600 tabular-nums">
                      {a.days} d · {WORK_STATUS_LABELS[a.workStatus]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Blocked stories and defects</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {flow.blocked.map((b) => (
                  <li key={b.storyId}>
                    <span className="font-mono text-xs text-slate-500">{b.refCode}</span> {b.title}{' '}
                    <span className="text-xs text-red-700">— {b.reason}</span>
                  </li>
                ))}
                {flow.blocked.length === 0 ? <li className="text-slate-500">No blocked stories.</li> : null}
              </ul>
              <p className="mt-3 text-xs text-slate-600">
                Defects: {defects.open} open ({defects.byStatus.open} new, {defects.byStatus.assigned} assigned,{' '}
                {defects.byStatus.in_progress} in progress, {defects.byStatus.ready_for_retest} ready for retest,{' '}
                {defects.byStatus.reopened} reopened), {defects.closed} closed.
              </p>
            </section>
          </div>
        </div>
      )}
    </DeliveryPage>
  );
}
