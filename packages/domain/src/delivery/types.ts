import type { Origin } from '../process/types';

/**
 * Phases 3 to 7: delivery. Functional and technical user stories are
 * written from approved process activities, reviewed, and added to the
 * product backlog. Backlog items are planned into sprints and worked on a
 * Kanban board. Business test scenarios are written from the stories, run
 * as UAT executions, and failed steps raise defects. All of it links back
 * to process activities, fields and rules so it can be traced end to end.
 *
 * Every record below is stored as-is (camelCase here, snake_case columns in
 * the database) and only changed through the delivery service, which
 * enforces the workflow rules for both the API and the in-browser demo.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

/** A process activity, identified across process versions by its element key. */
export interface ActivityRef {
  processId: string;
  nodeKey: string;
}

/** A plain-language item with a stable id, so edits and links survive reordering. */
export interface TextItem {
  id: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Stories (Phase 3) and backlog items (Phase 4)
// ---------------------------------------------------------------------------

export const STORY_TYPES = ['functional', 'technical'] as const;
export type StoryType = (typeof STORY_TYPES)[number];
export const STORY_TYPE_LABELS: Record<StoryType, string> = { functional: 'Functional', technical: 'Technical' };

/** Review status. Only approved stories can enter the backlog. */
export const STORY_STATUSES = ['draft', 'pending_review', 'approved', 'in_backlog'] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];
export const STORY_STATUS_LABELS: Record<StoryStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending Review',
  approved: 'Approved',
  in_backlog: 'Added to Backlog',
};

/** The six Kanban columns, in workflow order. */
export const WORK_STATUSES = ['todo', 'in_planning', 'in_development', 'ready_for_testing', 'in_testing', 'completed'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  todo: 'To-do',
  in_planning: 'In Planning',
  in_development: 'In Development',
  ready_for_testing: 'Ready for Testing',
  in_testing: 'In Testing',
  completed: 'Completed',
};

/** Whether a technical design came from AI and still needs a developer to confirm it. */
export const DESIGN_STATUSES = ['proposed', 'confirmed'] as const;
export type DesignStatus = (typeof DESIGN_STATUSES)[number];

export interface Story {
  id: string;
  projectId: string;
  /** US-001 for functional stories, TS-001 for technical stories. */
  refCode: string;
  storyType: StoryType;
  title: string;
  status: StoryStatus;
  origin: Origin;
  /** Content version: increases each time an approved story is reopened for changes. */
  version: number;

  // Functional
  /** "As a …" */
  userRole: string;
  /** "I want …" */
  objective: string;
  /** "So that …" */
  benefit: string;
  description: string;
  /** Main flow, one step per item. */
  behaviour: TextItem[];
  alternativeFlows: TextItem[];
  acceptanceCriteria: TextItem[];
  /** Notes on inputs, outputs or rules not covered by the links below. */
  notes: string;

  // Technical. AI designs stay "proposed" until a developer confirms them.
  apiBehaviour: string;
  requiredData: string;
  validationLogic: string;
  expectedResponse: string;
  errorScenarios: TextItem[];
  designStatus: DesignStatus;

  // Traceability
  activities: ActivityRef[];
  /** Input and output fields from the data dictionary. */
  fieldIds: string[];
  validationRuleIds: string[];
  businessRuleIds: string[];
  /** For technical stories: the functional stories they implement (many-to-many). */
  implementsIds: string[];
  /** Stories that must be completed first. */
  dependsOnIds: string[];

  // Backlog and work
  priority: Priority;
  /** 1 (low) to 10 (high). */
  businessValue: number | null;
  storyPoints: number | null;
  /** The first estimate, preserved once set. */
  originalEstimateHours: number | null;
  estimateHours: number | null;
  remainingHours: number | null;
  actualHours: number;
  assigneeId: string | null;
  backlogRank: number;
  workStatus: WorkStatus;
  blocked: boolean;
  blockedReason: string;
  /** Set when an approved process changes in a way that may affect this story. */
  reviewFlag: string | null;
  startedAt: string | null;
  completedAt: string | null;

  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

/** The fields a person edits as story content. Everything else changes through workflow operations. */
export const STORY_CONTENT_KEYS = [
  'title',
  'userRole',
  'objective',
  'benefit',
  'description',
  'behaviour',
  'alternativeFlows',
  'acceptanceCriteria',
  'notes',
  'apiBehaviour',
  'requiredData',
  'validationLogic',
  'expectedResponse',
  'errorScenarios',
  'activities',
  'fieldIds',
  'validationRuleIds',
  'businessRuleIds',
  'implementsIds',
  'dependsOnIds',
] as const satisfies readonly (keyof Story)[];
export type StoryContent = Pick<Story, (typeof STORY_CONTENT_KEYS)[number]>;

export const EMPTY_STORY_CONTENT: StoryContent = {
  title: '',
  userRole: '',
  objective: '',
  benefit: '',
  description: '',
  behaviour: [],
  alternativeFlows: [],
  acceptanceCriteria: [],
  notes: '',
  apiBehaviour: '',
  requiredData: '',
  validationLogic: '',
  expectedResponse: '',
  errorScenarios: [],
  activities: [],
  fieldIds: [],
  validationRuleIds: [],
  businessRuleIds: [],
  implementsIds: [],
  dependsOnIds: [],
};

/** Backlog attributes set by the Product Owner. */
export interface BacklogPatch {
  priority?: Priority;
  businessValue?: number | null;
  storyPoints?: number | null;
  estimateHours?: number | null;
  assigneeId?: string | null;
  backlogRank?: number;
}

// ---------------------------------------------------------------------------
// Sprints (Phase 4)
// ---------------------------------------------------------------------------

export const SPRINT_STATUSES = ['planned', 'active', 'completed', 'cancelled'] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];
export const SPRINT_STATUS_LABELS: Record<SprintStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export interface Sprint {
  id: string;
  projectId: string;
  refCode: string;
  name: string;
  objective: string;
  /** ISO dates (YYYY-MM-DD), inclusive. */
  startDate: string;
  endDate: string;
  status: SprintStatus;
  capacityHours: number;
  /** Only one sprint per team can be active, unless the project allows concurrent sprints. */
  team: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  revision: number;
}

/** A backlog item allocated to a sprint. The story stays in the backlog; this records the allocation. */
export interface SprintItem {
  id: string;
  projectId: string;
  sprintId: string;
  storyId: string;
  plannedHours: number;
  assigneeId: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  /** True when added before the sprint started: part of the sprint commitment. */
  committed: boolean;
  addedAt: string;
  /** Set when the item is taken out of the sprint. Kept for history. */
  removedAt: string | null;
}

// ---------------------------------------------------------------------------
// Business scenarios, UAT and defects (Phase 5)
// ---------------------------------------------------------------------------

export const SCENARIO_TYPES = ['main', 'alternative', 'exception'] as const;
export type ScenarioType = (typeof SCENARIO_TYPES)[number];
export const SCENARIO_TYPE_LABELS: Record<ScenarioType, string> = {
  main: 'Main',
  alternative: 'Alternative',
  exception: 'Exception',
};

export const SCENARIO_STATUSES = ['draft', 'approved'] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

export interface ScenarioStep {
  id: string;
  action: string;
  inputData: string;
  expectedBehaviour: string;
  expectedResult: string;
}

export interface BusinessScenario {
  id: string;
  projectId: string;
  /** BS-001 */
  refCode: string;
  title: string;
  scenarioType: ScenarioType;
  description: string;
  processId: string | null;
  activities: ActivityRef[];
  preconditions: TextItem[];
  steps: ScenarioStep[];
  /** The technical stories that must be completed before the scenario can be tested. */
  storyIds: string[];
  /** Other things UAT needs, such as test data or environment access. */
  prerequisites: string;
  prerequisitesMet: boolean;
  status: ScenarioStatus;
  origin: Origin;
  /** Increases on every content change, so each execution records what it tested. */
  version: number;
  reviewFlag: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export const STEP_RESULTS = ['not_tested', 'pass', 'fail', 'blocked'] as const;
export type StepResult = (typeof STEP_RESULTS)[number];
export const STEP_RESULT_LABELS: Record<StepResult, string> = {
  not_tested: 'Not Tested',
  pass: 'Pass',
  fail: 'Fail',
  blocked: 'Blocked',
};

export interface StepExecution {
  stepId: string;
  status: StepResult;
  testData: string;
  actualResult: string;
  remarks: string;
}

export const EXECUTION_STATUSES = ['in_progress', 'passed', 'failed', 'blocked'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** One UAT run of a scenario. Completed executions are never changed or deleted. */
export interface TestExecution {
  id: string;
  projectId: string;
  /** TE-001 */
  refCode: string;
  scenarioId: string;
  scenarioVersion: number;
  /** The steps as they were when testing started. */
  steps: ScenarioStep[];
  results: StepExecution[];
  status: ExecutionStatus;
  testerId: string;
  remarks: string;
  startedAt: string;
  completedAt: string | null;
  revision: number;
}

export const DEFECT_SEVERITIES = ['critical', 'major', 'minor', 'trivial'] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];
export const DEFECT_SEVERITY_LABELS: Record<DefectSeverity, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
  trivial: 'Trivial',
};

export const DEFECT_STATUSES = ['open', 'assigned', 'in_progress', 'ready_for_retest', 'closed', 'reopened'] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];
export const DEFECT_STATUS_LABELS: Record<DefectStatus, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  ready_for_retest: 'Ready for Retest',
  closed: 'Closed',
  reopened: 'Reopened',
};

export interface Attachment {
  id: string;
  name: string;
  /** A data: URL. Screenshots are kept small (see MAX_ATTACHMENT_BYTES). */
  dataUrl: string;
}

export const MAX_ATTACHMENT_BYTES = 400 * 1024;
export const MAX_ATTACHMENTS = 3;

export interface Defect {
  id: string;
  projectId: string;
  /** DEF-001 */
  refCode: string;
  title: string;
  description: string;
  severity: DefectSeverity;
  priority: Priority;
  status: DefectStatus;
  scenarioId: string | null;
  executionId: string | null;
  stepId: string | null;
  expectedResult: string;
  actualResult: string;
  remarks: string;
  storyIds: string[];
  assigneeId: string | null;
  sprintId: string | null;
  attachments: Attachment[];
  createdBy: string;
  createdAt: string;
  resolvedAt: string | null;
  revision: number;
}

// ---------------------------------------------------------------------------
// History, AI insights and settings
// ---------------------------------------------------------------------------

export const EVENT_ENTITIES = ['story', 'sprint', 'scenario', 'execution', 'defect'] as const;
export type EventEntity = (typeof EVENT_ENTITIES)[number];

/**
 * Append-only history: status changes (review and Kanban), effort updates,
 * comments and flags. Status-change events record the previous and new value.
 */
export const EVENT_KINDS = ['created', 'status', 'work_status', 'effort', 'comment', 'assignment', 'flag', 'edit'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface DeliveryEvent {
  id: string;
  projectId: string;
  entityType: EventEntity;
  entityId: string;
  kind: EventKind;
  fromValue: string | null;
  toValue: string | null;
  body: string;
  actorId: string;
  createdAt: string;
}

export const INSIGHT_KINDS = ['change_impact', 'improvement', 'consistency'] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];
export const INSIGHT_STATUSES = ['open', 'accepted', 'dismissed'] as const;
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];

/** An AI recommendation kept for review. Accepting one never edits approved content directly. */
export interface Insight {
  id: string;
  projectId: string;
  kind: InsightKind;
  title: string;
  detail: string;
  /** Records the insight is about, by ref code (e.g. US-003, ACT-004). */
  subjects: string[];
  impact: 'high' | 'medium' | 'low';
  processId: string | null;
  status: InsightStatus;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface DeliverySettings {
  projectId: string;
  /** Kanban cards move forward one column at a time (backwards is always allowed). */
  strictWorkflow: boolean;
  /** Allow more than one active sprint per team. */
  allowConcurrentSprints: boolean;
  /** A story must be assigned and estimated before development starts. */
  requireEstimateForDevelopment: boolean;
  defaultSprintCapacityHours: number;
  revision: number;
}

export const DEFAULT_DELIVERY_SETTINGS: Omit<DeliverySettings, 'projectId'> = {
  strictWorkflow: true,
  allowConcurrentSprints: false,
  requireEstimateForDevelopment: true,
  defaultSprintCapacityHours: 80,
  revision: 0,
};

/** Everything the delivery modules show for a project, loaded in one request. */
export interface DeliverySnapshot {
  settings: DeliverySettings;
  stories: Story[];
  sprints: Sprint[];
  sprintItems: SprintItem[];
  scenarios: BusinessScenario[];
  executions: TestExecution[];
  defects: Defect[];
  events: DeliveryEvent[];
  insights: Insight[];
}
