import { activeItems, IN_PROGRESS_STATUSES, scenarioReadiness, scenarioUatStatus, type UatStatus } from './workflow';
import {
  WORK_STATUSES,
  type BusinessScenario,
  type Defect,
  type DeliveryEvent,
  type Sprint,
  type SprintItem,
  type Story,
  type TestExecution,
  type WorkStatus,
} from './types';

/**
 * Delivery metrics, computed only from stored records. Nothing here is
 * estimated or filled in: a metric without data is reported as null.
 */

const DAY = 24 * 60 * 60 * 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Start and end of a sprint as timestamps. The end date is inclusive (end of that day, UTC). */
export function sprintWindow(sprint: Sprint): { start: number; end: number } {
  const start = sprint.startedAt ? Date.parse(sprint.startedAt) : Date.parse(`${sprint.startDate}T00:00:00Z`);
  const plannedEnd = Date.parse(`${sprint.endDate}T23:59:59.999Z`);
  const end = sprint.completedAt ? Math.min(Date.parse(sprint.completedAt), plannedEnd) : plannedEnd;
  return { start, end };
}

export interface SprintCapacity {
  capacityHours: number;
  allocatedHours: number;
  remainingHours: number;
  /** Allocated as a percentage of capacity, or null when capacity is zero. */
  utilisation: number | null;
  overCapacity: boolean;
  byDeveloper: { assigneeId: string | null; allocatedHours: number }[];
}

export function sprintCapacity(sprint: Sprint, items: SprintItem[]): SprintCapacity {
  const current = activeItems(items, sprint.id);
  const allocated = sum(current.map((i) => i.plannedHours));
  const byDev = new Map<string | null, number>();
  for (const i of current) byDev.set(i.assigneeId, (byDev.get(i.assigneeId) ?? 0) + i.plannedHours);
  return {
    capacityHours: sprint.capacityHours,
    allocatedHours: round1(allocated),
    remainingHours: round1(sprint.capacityHours - allocated),
    utilisation: sprint.capacityHours > 0 ? Math.round((allocated / sprint.capacityHours) * 100) : null,
    overCapacity: allocated > sprint.capacityHours,
    byDeveloper: [...byDev].map(([assigneeId, hours]) => ({ assigneeId, allocatedHours: round1(hours) })),
  };
}

export interface SprintVelocity {
  sprintId: string;
  committedCount: number;
  committedPoints: number;
  committedHours: number;
  /** Committed stories completed within the sprint window. */
  completedCount: number;
  completedPoints: number;
  completedHours: number;
  /** Stories added after the sprint started and completed within it; reported apart from the commitment. */
  addedCompletedCount: number;
  addedCompletedPoints: number;
  addedCompletedHours: number;
  /** Completed committed stories as a percentage of committed stories, or null with no commitment. */
  completionRate: number | null;
}

/**
 * Velocity is reported as two separate measures: story points and estimated
 * hours of committed work completed within the sprint. A story completed
 * after the sprint ended, or one that was taken out of the sprint, does not
 * count toward the sprint's committed work.
 */
export function sprintVelocity(sprint: Sprint, items: SprintItem[], stories: Story[]): SprintVelocity {
  const { start, end } = sprintWindow(sprint);
  const byId = new Map(stories.map((s) => [s.id, s]));
  const inSprint = items.filter((i) => i.sprintId === sprint.id);
  const committed = inSprint.filter((i) => i.committed && (i.removedAt === null || Date.parse(i.removedAt) > end));
  const added = inSprint.filter((i) => !i.committed && i.removedAt === null);
  const doneInWindow = (i: SprintItem) => {
    const s = byId.get(i.storyId);
    if (!s || s.workStatus !== 'completed' || !s.completedAt) return false;
    const t = Date.parse(s.completedAt);
    return t >= start && t <= end;
  };
  const points = (list: SprintItem[]) => sum(list.map((i) => byId.get(i.storyId)?.storyPoints ?? 0));
  const hours = (list: SprintItem[]) => round1(sum(list.map((i) => byId.get(i.storyId)?.estimateHours ?? i.plannedHours)));
  const completed = committed.filter(doneInWindow);
  const addedDone = added.filter(doneInWindow);
  return {
    sprintId: sprint.id,
    committedCount: committed.length,
    committedPoints: points(committed),
    committedHours: hours(committed),
    completedCount: completed.length,
    completedPoints: points(completed),
    completedHours: hours(completed),
    addedCompletedCount: addedDone.length,
    addedCompletedPoints: points(addedDone),
    addedCompletedHours: hours(addedDone),
    completionRate: committed.length > 0 ? Math.round((completed.length / committed.length) * 100) : null,
  };
}

export interface BurndownPoint {
  date: string;
  /** Ideal remaining hours, falling evenly from the committed total to zero. */
  ideal: number;
  /** Recorded remaining hours at the end of the day, or null for days still to come. */
  remaining: number | null;
}

/**
 * Remaining hours of the sprint's committed work at the end of each day,
 * from the effort updates recorded on each story. Before its first update a
 * story counts at its planned hours; once completed it counts as zero.
 */
export function sprintBurndown(sprint: Sprint, items: SprintItem[], stories: Story[], events: DeliveryEvent[], now: string): BurndownPoint[] {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const committed = items.filter((i) => i.sprintId === sprint.id && i.committed);
  const effort = new Map<string, { at: number; value: number }[]>();
  for (const e of events) {
    if (e.entityType !== 'story' || e.kind !== 'effort' || e.toValue === null) continue;
    const list = effort.get(e.entityId) ?? [];
    list.push({ at: Date.parse(e.createdAt), value: Number(e.toValue) });
    effort.set(e.entityId, list);
  }
  for (const list of effort.values()) list.sort((a, b) => a.at - b.at);

  const startDay = Date.parse(`${sprint.startDate}T00:00:00Z`);
  const endDay = Date.parse(`${sprint.endDate}T00:00:00Z`);
  const days = Math.max(0, Math.round((endDay - startDay) / DAY)) + 1;
  const total = sum(committed.map((i) => i.plannedHours));
  const nowMs = Date.parse(now);
  const points: BurndownPoint[] = [];
  for (let d = 0; d < days; d++) {
    const dayStart = startDay + d * DAY;
    const dayEnd = dayStart + DAY - 1;
    let remaining: number | null = null;
    if (dayStart <= nowMs) {
      remaining = 0;
      for (const item of committed) {
        if (item.removedAt && Date.parse(item.removedAt) <= dayEnd) continue;
        const story = byId.get(item.storyId);
        if (story?.completedAt && Date.parse(story.completedAt) <= dayEnd && story.workStatus === 'completed') continue;
        const updates = (effort.get(item.storyId) ?? []).filter((u) => u.at <= dayEnd);
        remaining += updates.length ? updates[updates.length - 1]!.value : item.plannedHours;
      }
      remaining = round1(remaining);
    }
    points.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      ideal: round1(days > 1 ? total - (total * d) / (days - 1) : 0),
      remaining,
    });
  }
  return points;
}

export interface FlowMetrics {
  workInProgress: number;
  /** Average days from development start to completion, or null with no completed stories. */
  averageCycleDays: number | null;
  /** Stories in progress, oldest first, with days since development started. */
  ageing: { storyId: string; refCode: string; title: string; days: number; workStatus: WorkStatus }[];
  blocked: { storyId: string; refCode: string; title: string; reason: string }[];
  statusCounts: Record<WorkStatus, number>;
}

export function flowMetrics(stories: Story[], now: string): FlowMetrics {
  const backlog = stories.filter((s) => s.status === 'in_backlog');
  const nowMs = Date.parse(now);
  const cycles = backlog
    .filter((s) => s.workStatus === 'completed' && s.startedAt && s.completedAt)
    .map((s) => (Date.parse(s.completedAt!) - Date.parse(s.startedAt!)) / DAY);
  const wip = backlog.filter((s) => IN_PROGRESS_STATUSES.includes(s.workStatus));
  const statusCounts = Object.fromEntries(WORK_STATUSES.map((w) => [w, 0])) as Record<WorkStatus, number>;
  for (const s of backlog) statusCounts[s.workStatus] += 1;
  return {
    workInProgress: wip.length,
    averageCycleDays: cycles.length ? round1(sum(cycles) / cycles.length) : null,
    ageing: wip
      .filter((s) => s.startedAt)
      .map((s) => ({
        storyId: s.id,
        refCode: s.refCode,
        title: s.title,
        days: round1((nowMs - Date.parse(s.startedAt!)) / DAY),
        workStatus: s.workStatus,
      }))
      .sort((a, b) => b.days - a.days),
    blocked: backlog
      .filter((s) => s.blocked && s.workStatus !== 'completed')
      .map((s) => ({ storyId: s.id, refCode: s.refCode, title: s.title, reason: s.blockedReason })),
    statusCounts,
  };
}

export interface DeveloperWorkload {
  assigneeId: string | null;
  plannedHours: number;
  remainingHours: number;
  openStories: number;
}

/** Planned and remaining hours per developer for the stories allocated to a sprint. */
export function developerWorkload(sprint: Sprint, items: SprintItem[], stories: Story[]): DeveloperWorkload[] {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const result = new Map<string | null, DeveloperWorkload>();
  for (const item of activeItems(items, sprint.id)) {
    const story = byId.get(item.storyId);
    const assigneeId = story?.assigneeId ?? item.assigneeId;
    const row = result.get(assigneeId) ?? { assigneeId, plannedHours: 0, remainingHours: 0, openStories: 0 };
    row.plannedHours = round1(row.plannedHours + item.plannedHours);
    if (story && story.workStatus !== 'completed') {
      row.remainingHours = round1(row.remainingHours + (story.remainingHours ?? story.estimateHours ?? item.plannedHours));
      row.openStories += 1;
    }
    result.set(assigneeId, row);
  }
  return [...result.values()].sort((a, b) => b.plannedHours - a.plannedHours);
}

export interface UatSummary {
  counts: Record<UatStatus, number>;
  /** Passed scenarios as a percentage of scenarios with a completed test, or null if none were tested. */
  passRate: number | null;
}

export function uatSummary(scenarios: BusinessScenario[], stories: Story[], executions: TestExecution[]): UatSummary {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const counts: Record<UatStatus, number> = { not_ready: 0, ready: 0, in_progress: 0, passed: 0, failed: 0, blocked: 0 };
  for (const sc of scenarios) counts[scenarioUatStatus(sc, executions, scenarioReadiness(sc, byId))] += 1;
  const tested = counts.passed + counts.failed + counts.blocked;
  return { counts, passRate: tested > 0 ? Math.round((counts.passed / tested) * 100) : null };
}

export interface DefectSummary {
  open: number;
  closed: number;
  bySeverity: Record<Defect['severity'], number>;
  byStatus: Record<Defect['status'], number>;
}

export function defectSummary(defects: Defect[]): DefectSummary {
  const bySeverity = { critical: 0, major: 0, minor: 0, trivial: 0 };
  const byStatus = { open: 0, assigned: 0, in_progress: 0, ready_for_retest: 0, closed: 0, reopened: 0 };
  for (const d of defects) {
    byStatus[d.status] += 1;
    if (d.status !== 'closed') bySeverity[d.severity] += 1;
  }
  return { open: defects.length - byStatus.closed, closed: byStatus.closed, bySeverity, byStatus };
}

/** Planned (estimated) and actual hours of a set of stories. */
export function effortTotals(stories: Story[]): { estimated: number; original: number; actual: number; remaining: number } {
  return {
    estimated: round1(sum(stories.map((s) => s.estimateHours ?? 0))),
    original: round1(sum(stories.map((s) => s.originalEstimateHours ?? 0))),
    actual: round1(sum(stories.map((s) => s.actualHours))),
    remaining: round1(sum(stories.filter((s) => s.workStatus !== 'completed').map((s) => s.remainingHours ?? s.estimateHours ?? 0))),
  };
}
