import type { ProjectRole } from '../roles';
import {
  WORK_STATUS_LABELS,
  WORK_STATUSES,
  type BusinessScenario,
  type DefectStatus,
  type DeliverySettings,
  type ExecutionStatus,
  type Sprint,
  type SprintItem,
  type StepExecution,
  type Story,
  type StoryStatus,
  type TestExecution,
  type WorkStatus,
} from './types';

/**
 * Workflow rules for stories, Kanban cards, scenarios and defects. The
 * delivery service applies them on every change; the UI uses the same
 * functions to explain why an action is unavailable.
 */

const has = (role: ProjectRole | null, roles: readonly ProjectRole[]) => role !== null && roles.includes(role);

export const DELIVERY_ROLES = {
  editFunctional: ['admin', 'business_analyst'],
  editTechnical: ['admin', 'business_analyst', 'developer'],
  reviewStory: ['admin', 'product_owner'],
  manageBacklog: ['admin', 'product_owner'],
  updateWork: ['admin', 'product_owner', 'developer'],
  editScenarios: ['admin', 'business_analyst'],
  approveScenario: ['admin', 'product_owner'],
  executeTests: ['admin', 'product_owner', 'business_analyst', 'business_user'],
  workDefect: ['admin', 'product_owner', 'developer'],
  verifyDefect: ['admin', 'product_owner', 'business_analyst', 'business_user'],
  runInsights: ['admin', 'product_owner', 'business_analyst'],
  manageSettings: ['admin'],
} as const satisfies Record<string, readonly ProjectRole[]>;

export type DeliveryPermission = keyof typeof DELIVERY_ROLES;

export function canDeliver(role: ProjectRole | null | undefined, permission: DeliveryPermission): boolean {
  return has(role ?? null, DELIVERY_ROLES[permission]);
}

/** Who may edit a story's content: analysts write functional stories; developers also write technical ones. */
export function canEditStory(role: ProjectRole | null, story: Pick<Story, 'storyType'>): boolean {
  return canDeliver(role, story.storyType === 'technical' ? 'editTechnical' : 'editFunctional');
}

// ---------------------------------------------------------------------------
// Story review
// ---------------------------------------------------------------------------

/** Problems that stop a story from being submitted for review. */
export function storyReadinessProblems(story: Story): string[] {
  const problems: string[] = [];
  if (!story.title.trim()) problems.push('Give the story a title');
  if (story.acceptanceCriteria.filter((c) => c.text.trim()).length === 0) problems.push('Add at least one acceptance criterion');
  if (story.storyType === 'functional' && !story.objective.trim()) problems.push('State what the user wants ("I want …")');
  if (story.storyType === 'technical' && story.designStatus === 'proposed') {
    problems.push('A developer must confirm the proposed technical design first');
  }
  return problems;
}

/**
 * Checks a review-status change. Returns the reason it is not allowed, or
 * null. `openSprintItem` is true when the story is allocated to a sprint
 * that is planned or active.
 */
export function checkStoryStatusChange(
  story: Story,
  to: StoryStatus,
  role: ProjectRole | null,
  openSprintItem: boolean,
): string | null {
  const from = story.status;
  if (from === to) return `${story.refCode} is already ${to.replace('_', ' ')}`;
  const editor = canEditStory(role, story);
  const reviewer = canDeliver(role, 'reviewStory');
  if (from === 'draft' && to === 'pending_review') {
    if (!editor) return 'You do not have permission to submit this story for review';
    const problems = storyReadinessProblems(story);
    return problems.length ? `${story.refCode} is not ready for review: ${problems.join('; ')}` : null;
  }
  if (from === 'pending_review' && to === 'approved') {
    return reviewer ? null : 'Only a Product Owner or Administrator can approve a story';
  }
  if (from === 'pending_review' && to === 'draft') {
    return editor || reviewer ? null : 'You do not have permission to return this story to draft';
  }
  if (from === 'approved' && to === 'in_backlog') {
    return canDeliver(role, 'manageBacklog') ? null : 'Only a Product Owner or Administrator can add stories to the backlog';
  }
  if ((from === 'approved' || from === 'in_backlog') && to === 'draft') {
    if (!editor && !reviewer) return 'You do not have permission to reopen this story';
    if (story.workStatus !== 'todo') return `${story.refCode} is already being worked on and cannot be reopened`;
    if (openSprintItem) return `Remove ${story.refCode} from its sprint before reopening it`;
    return null;
  }
  if (to === 'in_backlog') return 'A story must be approved before it is added to the backlog';
  if (to === 'approved') return 'A story must be reviewed before it is approved';
  return `A story cannot move from ${from.replace('_', ' ')} to ${to.replace('_', ' ')}`;
}

// ---------------------------------------------------------------------------
// Kanban
// ---------------------------------------------------------------------------

export const workIndex = (status: WorkStatus) => WORK_STATUSES.indexOf(status);
export const IN_PROGRESS_STATUSES: WorkStatus[] = ['in_development', 'ready_for_testing', 'in_testing'];

export interface WorkMoveContext {
  settings: Pick<DeliverySettings, 'strictWorkflow' | 'requireEstimateForDevelopment'>;
  /** The sprint the story is allocated to, if any (not removed). */
  sprint: Sprint | null;
  /** Stories this one depends on. */
  dependencies: Story[];
}

/** Checks a Kanban move. Returns the reason it is not allowed, or null. */
export function checkWorkMove(story: Story, to: WorkStatus, role: ProjectRole | null, ctx: WorkMoveContext): string | null {
  if (!canDeliver(role, 'updateWork')) return 'Only Developers, Product Owners and Administrators can move cards';
  if (story.status !== 'in_backlog') return `${story.refCode} is not in the backlog yet`;
  const from = workIndex(story.workStatus);
  const target = workIndex(to);
  if (from === target) return null;
  if (target < from) return null; // moving back is always allowed
  if (story.blocked)
    return `${story.refCode} is blocked${story.blockedReason ? `: ${story.blockedReason}` : ''}. Unblock it first`;
  if (ctx.settings.strictWorkflow && target > from + 1) {
    return `Move ${story.refCode} one column at a time: next is ${WORK_STATUS_LABELS[WORK_STATUSES[from + 1]!]}`;
  }
  if (target >= workIndex('in_development')) {
    if (!ctx.sprint || ctx.sprint.status !== 'active')
      return `${story.refCode} must be in an active sprint before development starts`;
    if (ctx.settings.requireEstimateForDevelopment && (!story.assigneeId || story.estimateHours === null)) {
      return `Assign ${story.refCode} to a developer and estimate it before development starts`;
    }
    const waiting = ctx.dependencies.filter((d) => d.workStatus !== 'completed');
    if (waiting.length > 0) {
      return `${story.refCode} depends on ${waiting.map((d) => d.refCode).join(', ')}, which must be completed first`;
    }
  }
  return null;
}

/** Applies a permitted Kanban move: dates and remaining effort follow the column. */
export function applyWorkMove(story: Story, to: WorkStatus, now: string): Story {
  const next = { ...story, workStatus: to };
  if (workIndex(to) >= workIndex('in_development') && !story.startedAt) next.startedAt = now;
  if (to === 'completed') {
    next.completedAt = now;
    next.remainingHours = 0;
  } else if (story.workStatus === 'completed') {
    next.completedAt = null;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

export function checkSprintStatusChange(
  sprint: Sprint,
  to: Sprint['status'],
  otherActive: Sprint[],
  allowConcurrent: boolean,
): string | null {
  const allowed: Record<Sprint['status'], Sprint['status'][]> = {
    planned: ['active', 'cancelled'],
    active: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };
  if (!allowed[sprint.status].includes(to)) return `A ${sprint.status} sprint cannot become ${to}`;
  if (to === 'active' && !allowConcurrent) {
    const clash = otherActive.find((s) => s.id !== sprint.id && s.team.trim().toLowerCase() === sprint.team.trim().toLowerCase());
    if (clash) return `${clash.name} is already active for this team. Complete it first, or allow concurrent sprints in Settings`;
  }
  return null;
}

/** Items currently allocated to a sprint. */
export const activeItems = (items: SprintItem[], sprintId: string) =>
  items.filter((i) => i.sprintId === sprintId && i.removedAt === null);

// ---------------------------------------------------------------------------
// Business scenarios and UAT
// ---------------------------------------------------------------------------

export interface ScenarioReadiness {
  ready: boolean;
  reasons: string[];
}

/** A scenario is Ready for UAT once approved, its technical stories are completed and its prerequisites are met. */
export function scenarioReadiness(scenario: BusinessScenario, storiesById: Map<string, Story>): ScenarioReadiness {
  const reasons: string[] = [];
  if (scenario.status !== 'approved') reasons.push('The scenario has not been approved');
  if (scenario.storyIds.length === 0) reasons.push('Link the technical stories this scenario tests');
  for (const id of scenario.storyIds) {
    const story = storiesById.get(id);
    if (!story) reasons.push('A linked story was deleted');
    else if (story.workStatus !== 'completed') {
      reasons.push(`${story.refCode} is ${WORK_STATUS_LABELS[story.workStatus]}, not Completed`);
    }
  }
  if (scenario.prerequisites.trim() && !scenario.prerequisitesMet) reasons.push('Prerequisites are not confirmed as met');
  return { ready: reasons.length === 0, reasons };
}

/** Orders executions newest first (ref codes break ties, as they are issued in order). */
export const newestExecutionFirst = (a: TestExecution, b: TestExecution) =>
  b.startedAt.localeCompare(a.startedAt) || b.refCode.localeCompare(a.refCode, undefined, { numeric: true });

export type UatStatus = 'not_ready' | 'ready' | 'in_progress' | ExecutionStatus;
export const UAT_STATUS_LABELS: Record<UatStatus, string> = {
  not_ready: 'Not Ready for Testing',
  ready: 'Ready for UAT',
  in_progress: 'Testing in progress',
  passed: 'Passed',
  failed: 'Failed',
  blocked: 'Blocked',
};

/**
 * The scenario's UAT status. A completed execution's result stands until a
 * later execution replaces it, so a failed scenario stays failed until it is
 * retested; it is never marked passed automatically.
 */
export function scenarioUatStatus(
  scenario: BusinessScenario,
  executions: TestExecution[],
  readiness: ScenarioReadiness,
): UatStatus {
  const runs = executions.filter((e) => e.scenarioId === scenario.id).sort(newestExecutionFirst);
  if (runs[0]?.status === 'in_progress') return 'in_progress';
  const lastCompleted = runs.find((r) => r.status !== 'in_progress');
  if (lastCompleted) return lastCompleted.status;
  return readiness.ready ? 'ready' : 'not_ready';
}

/** The result of a finished execution, or the reason it cannot be completed yet. */
export function executionOutcome(
  results: StepExecution[],
): { status: Exclude<ExecutionStatus, 'in_progress'> } | { error: string } {
  if (results.some((r) => r.status === 'fail')) return { status: 'failed' };
  if (results.some((r) => r.status === 'blocked')) return { status: 'blocked' };
  if (results.some((r) => r.status === 'not_tested'))
    return { error: 'Record a result for every step before completing the test' };
  return { status: 'passed' };
}

// ---------------------------------------------------------------------------
// Defects
// ---------------------------------------------------------------------------

const DEFECT_FLOW: Record<DefectStatus, DefectStatus[]> = {
  open: ['assigned', 'in_progress', 'closed'],
  assigned: ['in_progress', 'open', 'closed'],
  in_progress: ['ready_for_retest', 'assigned', 'closed'],
  ready_for_retest: ['closed', 'reopened'],
  closed: ['reopened'],
  reopened: ['assigned', 'in_progress', 'closed'],
};

export function allowedDefectTransitions(from: DefectStatus): DefectStatus[] {
  return DEFECT_FLOW[from];
}

/**
 * Checks a defect status change. Developers work on defects; testers verify
 * the fix (close or reopen after retest); Product Owners and Administrators
 * can also close a defect that will not be fixed.
 */
export function checkDefectStatusChange(
  defect: { status: DefectStatus; assigneeId: string | null; refCode: string },
  to: DefectStatus,
  role: ProjectRole | null,
): string | null {
  if (!DEFECT_FLOW[defect.status].includes(to)) return `${defect.refCode} cannot move from ${defect.status} to ${to}`;
  if ((to === 'assigned' || to === 'in_progress') && !defect.assigneeId) return `Assign ${defect.refCode} to someone first`;
  const verifying = to === 'reopened' || (to === 'closed' && defect.status === 'ready_for_retest');
  if (verifying) return canDeliver(role, 'verifyDefect') ? null : 'Only testers can close or reopen a defect after retesting';
  if (to === 'closed')
    return canDeliver(role, 'manageBacklog')
      ? null
      : 'Only a Product Owner or Administrator can close a defect before it is retested';
  return canDeliver(role, 'workDefect') ? null : 'Only Developers, Product Owners and Administrators can work on defects';
}

/** Finds a dependency cycle through `dependsOnIds`, returning the ref codes involved, or null. */
export function findDependencyCycle(stories: Pick<Story, 'id' | 'refCode' | 'dependsOnIds'>[], startId: string): string[] | null {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const path: string[] = [];
  const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return id === startId;
    const story = byId.get(id);
    if (!story) return false;
    visiting.add(id);
    path.push(story.refCode);
    for (const next of story.dependsOnIds) if (visit(next)) return true;
    path.pop();
    return false;
  };
  return visit(startId) ? path : null;
}
