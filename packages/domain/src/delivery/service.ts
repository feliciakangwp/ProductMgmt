import { z } from 'zod';
import type { ProjectRole } from '../roles';
import {
  CHANGE_IMPACT_TASK,
  IMPROVEMENT_TASK,
  REFINEMENT_TASK,
  SCENARIO_GENERATION_TASK,
  STORY_GENERATION_TASK,
  TECHNICAL_STORY_TASK,
  type AiTaskDefinition,
  type ChangeImpactAssessment,
  type Refinement,
} from './ai';
import { activityIndex, activityKey, analyseChangeImpact, approvedVersion, currentVersion, type ChangeImpact, type ProjectContext } from './trace';
import {
  DEFAULT_DELIVERY_SETTINGS,
  DEFECT_SEVERITIES,
  DEFECT_STATUSES,
  DESIGN_STATUSES,
  EMPTY_STORY_CONTENT,
  EVENT_ENTITIES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  PRIORITIES,
  SCENARIO_STATUSES,
  SCENARIO_TYPES,
  SPRINT_STATUSES,
  STEP_RESULTS,
  STORY_STATUSES,
  STORY_TYPES,
  WORK_STATUSES,
  type BusinessScenario,
  type Defect,
  type DeliveryEvent,
  type DeliverySettings,
  type DeliverySnapshot,
  type EventEntity,
  type EventKind,
  type Insight,
  type Sprint,
  type SprintItem,
  type Story,
  type StoryContent,
  type StoryType,
  type TestExecution,
} from './types';
import {
  activeItems,
  applyWorkMove,
  canDeliver,
  canEditStory,
  checkDefectStatusChange,
  checkSprintStatusChange,
  checkStoryStatusChange,
  checkWorkMove,
  executionOutcome,
  findDependencyCycle,
  scenarioReadiness,
  type DeliveryPermission,
} from './workflow';

/**
 * The delivery service: every change to stories, the backlog, sprints,
 * scenarios, test executions, defects and AI insights goes through these
 * operations. The API runs them for signed-in users (with the database
 * denying direct writes), and the in-browser demo runs the same code against
 * browser storage, so the rules are written and tested once.
 *
 * Each operation checks the caller's project role, validates its input,
 * applies the workflow rules, and uses optimistic locking: callers pass the
 * revision they read and get a PF409 conflict if it changed.
 */

// ---------------------------------------------------------------------------
// Errors, storage and context
// ---------------------------------------------------------------------------

/** Error codes shared with the database layer: see apps/web/src/lib/errors.ts. */
export type DomainErrorCode = 'PF409' | 'PF422' | 'PF423' | '42501' | 'P0002' | 'invalid_request' | `ai_${string}`;

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: DomainErrorCode,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface DeliveryEntities {
  stories: Story;
  sprints: Sprint;
  sprintItems: SprintItem;
  scenarios: BusinessScenario;
  executions: TestExecution;
  defects: Defect;
  events: DeliveryEvent;
  insights: Insight;
}
export type DeliveryKind = keyof DeliveryEntities;

export interface DeliveryStore {
  memberRole(projectId: string, userId: string): Promise<ProjectRole | null>;
  context(projectId: string): Promise<ProjectContext>;
  list<K extends DeliveryKind>(kind: K, projectId: string): Promise<DeliveryEntities[K][]>;
  get<K extends DeliveryKind>(kind: K, id: string): Promise<DeliveryEntities[K] | null>;
  insert<K extends DeliveryKind>(kind: K, row: DeliveryEntities[K]): Promise<void>;
  /** Replaces the row. With `expectedRevision`, only if the stored revision still matches; returns false if not. */
  update<K extends DeliveryKind>(kind: K, row: DeliveryEntities[K], expectedRevision?: number): Promise<boolean>;
  remove(kind: DeliveryKind, id: string): Promise<void>;
  nextRef(projectId: string, prefix: string): Promise<string>;
  /** The project a process belongs to, or null if there is no such process. */
  processProject(processId: string): Promise<string | null>;
  getSettings(projectId: string): Promise<DeliverySettings | null>;
  /** Saves settings if the stored revision equals `expectedRevision` (0 when none are stored yet). */
  saveSettings(settings: DeliverySettings, expectedRevision: number): Promise<boolean>;
}

export interface AiRunResult<O> {
  value: O;
  model: string;
  runId: string;
}

/** Runs an AI task and records the run. Throws DomainError with an `ai_*` code when it fails. */
export interface AiGateway {
  run<I, O>(task: AiTaskDefinition<I, O>, input: I, meta: { projectId: string; subjectId: string }, signal?: AbortSignal): Promise<AiRunResult<O>>;
}

export interface OpContext {
  store: DeliveryStore;
  userId: string;
  ai: AiGateway;
  now(): string;
  newId(): string;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const Id = z.string().min(1).max(100);
const ShortText = z.string().max(300);
const LongText = z.string().max(10000);
const Item = z.strictObject({ id: Id, text: z.string().max(2000) });
const Items = z.array(Item).max(100);
const Ids = z.array(Id).max(200);
const ActivityRefSchema = z.strictObject({ processId: Id, nodeKey: Id });
const Hours = z.number().min(0).max(10000);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in the form YYYY-MM-DD');

const StoryContentSchema = z.strictObject({
  title: ShortText,
  userRole: ShortText,
  objective: LongText,
  benefit: LongText,
  description: LongText,
  behaviour: Items,
  alternativeFlows: Items,
  acceptanceCriteria: Items,
  notes: LongText,
  apiBehaviour: LongText,
  requiredData: LongText,
  validationLogic: LongText,
  expectedResponse: LongText,
  errorScenarios: Items,
  activities: z.array(ActivityRefSchema).max(50),
  fieldIds: Ids,
  validationRuleIds: Ids,
  businessRuleIds: Ids,
  implementsIds: Ids,
  dependsOnIds: Ids,
});

const NewStorySchema = z.strictObject({
  storyType: z.enum(STORY_TYPES),
  content: StoryContentSchema.partial(),
  origin: z.enum(['stated', 'inferred', 'manual']).default('manual'),
  designStatus: z.enum(DESIGN_STATUSES).optional(),
});

const StepSchema = z.strictObject({
  id: Id,
  action: z.string().max(2000),
  inputData: z.string().max(2000),
  expectedBehaviour: z.string().max(2000),
  expectedResult: z.string().max(2000),
});

const ScenarioContentSchema = z.strictObject({
  title: ShortText,
  scenarioType: z.enum(SCENARIO_TYPES),
  description: LongText,
  processId: Id.nullable(),
  activities: z.array(ActivityRefSchema).max(50),
  preconditions: Items,
  steps: z.array(StepSchema).max(100),
  storyIds: Ids,
  prerequisites: LongText,
});
type ScenarioContent = z.infer<typeof ScenarioContentSchema>;

const NewScenarioSchema = z.strictObject({
  content: ScenarioContentSchema,
  origin: z.enum(['stated', 'inferred', 'manual']).default('manual'),
});

const AttachmentSchema = z.strictObject({ id: Id, name: ShortText, dataUrl: z.string().max(Math.ceil(MAX_ATTACHMENT_BYTES * 1.4)) });

const DefectFieldsSchema = z.strictObject({
  title: ShortText,
  description: LongText,
  severity: z.enum(DEFECT_SEVERITIES),
  priority: z.enum(PRIORITIES),
  assigneeId: Id.nullable(),
  sprintId: Id.nullable(),
  storyIds: Ids,
  attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS),
  expectedResult: LongText,
  actualResult: LongText,
  remarks: LongText,
});

const SprintFieldsSchema = z.strictObject({
  name: ShortText,
  objective: LongText,
  startDate: IsoDate,
  endDate: IsoDate,
  capacityHours: Hours,
  team: ShortText,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fail = (message: string, code: DomainErrorCode): never => {
  throw new DomainError(message, code);
};

async function roleIn(ctx: OpContext, projectId: string): Promise<ProjectRole> {
  const role = await ctx.store.memberRole(projectId, ctx.userId);
  return role ?? fail('Project not found.', 'P0002');
}

async function requirePermission(ctx: OpContext, projectId: string, permission: DeliveryPermission, message: string) {
  const role = await roleIn(ctx, projectId);
  if (!canDeliver(role, permission)) fail(message, '42501');
  return role;
}

async function load<K extends DeliveryKind>(ctx: OpContext, kind: K, id: string): Promise<DeliveryEntities[K]> {
  const row = await ctx.store.get(kind, id);
  if (!row) return fail('Not found.', 'P0002');
  // Membership is checked here so a non-member cannot tell whether a record exists.
  if (!(await ctx.store.memberRole(row.projectId, ctx.userId))) return fail('Not found.', 'P0002');
  return row;
}

type Revisioned = Story | Sprint | BusinessScenario | TestExecution | Defect;

/** Saves a revisioned record if nobody changed it since `expected`, bumping its revision. */
async function save<K extends 'stories' | 'sprints' | 'scenarios' | 'executions' | 'defects'>(
  ctx: OpContext,
  kind: K,
  row: DeliveryEntities[K] & Revisioned,
  expected: number,
): Promise<DeliveryEntities[K]> {
  const next = { ...row, revision: expected + 1 } as DeliveryEntities[K] & Revisioned;
  if ('updatedAt' in next) (next as { updatedAt: string }).updatedAt = ctx.now();
  const ok = await ctx.store.update(kind, next, expected);
  if (!ok) fail(`${row.refCode} was changed by someone else since you opened it. Reload to see those changes.`, 'PF409');
  return next;
}

function checkRevision(row: Revisioned, revision: number) {
  if (row.revision !== revision) {
    fail(`${row.refCode} was changed by someone else since you opened it. Reload to see those changes.`, 'PF409');
  }
}

async function recordEvent(
  ctx: OpContext,
  projectId: string,
  entityType: EventEntity,
  entityId: string,
  kind: EventKind,
  values: { from?: string | null; to?: string | null; body?: string } = {},
) {
  await ctx.store.insert('events', {
    id: ctx.newId(),
    projectId,
    entityType,
    entityId,
    kind,
    fromValue: values.from ?? null,
    toValue: values.to ?? null,
    body: values.body ?? '',
    actorId: ctx.userId,
    createdAt: ctx.now(),
  });
}

async function settingsFor(ctx: OpContext, projectId: string): Promise<DeliverySettings> {
  return (await ctx.store.getSettings(projectId)) ?? { projectId, ...DEFAULT_DELIVERY_SETTINGS };
}

async function loadSnapshot(ctx: OpContext, projectId: string): Promise<DeliverySnapshot> {
  const [settings, stories, sprints, sprintItems, scenarios, executions, defects, events, insights] = await Promise.all([
    settingsFor(ctx, projectId),
    ctx.store.list('stories', projectId),
    ctx.store.list('sprints', projectId),
    ctx.store.list('sprintItems', projectId),
    ctx.store.list('scenarios', projectId),
    ctx.store.list('executions', projectId),
    ctx.store.list('defects', projectId),
    ctx.store.list('events', projectId),
    ctx.store.list('insights', projectId),
  ]);
  return { settings, stories, sprints, sprintItems, scenarios, executions, defects, events, insights };
}

const nonEmptyItems = (items: { id: string; text: string }[]) =>
  items.map((i) => ({ id: i.id, text: i.text.trim() })).filter((i) => i.text);

const toItems = (ctx: OpContext, texts: string[]) => texts.map((text) => ({ id: ctx.newId(), text: text.trim() })).filter((i) => i.text);

async function checkMember(ctx: OpContext, projectId: string, userId: string | null | undefined) {
  if (userId && !(await ctx.store.memberRole(projectId, userId))) fail('The assignee is not a member of this project', 'PF422');
}

/** Validates that every link points at a record of the right kind in the same project. */
async function checkStoryLinks(ctx: OpContext, story: Story, stories: Story[], context: ProjectContext) {
  const index = activityIndex(context);
  const bad = (what: string) => fail(`${story.refCode || 'The story'} links to ${what} that is not in this project`, 'PF422');
  for (const a of story.activities) if (!index.has(activityKey(a))) bad('an activity');
  const fieldIds = new Set(context.fields.map((f) => f.id));
  if (story.fieldIds.some((id) => !fieldIds.has(id))) bad('a field');
  const ruleIds = new Set(context.validationRules.map((r) => r.id));
  if (story.validationRuleIds.some((id) => !ruleIds.has(id))) bad('a validation rule');
  const brIds = new Set(context.businessRules.map((r) => r.id));
  if (story.businessRuleIds.some((id) => !brIds.has(id))) bad('a business rule');
  const byId = new Map(stories.map((s) => [s.id, s]));
  if (story.implementsIds.length && story.storyType !== 'technical') fail('Only technical stories implement other stories', 'PF422');
  if (story.implementsIds.some((id) => byId.get(id)?.storyType !== 'functional')) bad('a functional story');
  if (story.dependsOnIds.some((id) => !byId.has(id))) bad('a story');
  if (story.dependsOnIds.includes(story.id)) fail('A story cannot depend on itself', 'PF422');
  const cycle = findDependencyCycle([...stories.filter((s) => s.id !== story.id), story], story.id);
  if (cycle) fail(`These dependencies form a loop: ${cycle.join(' → ')}`, 'PF422');
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normaliseContent(content: Partial<StoryContent>): Partial<StoryContent> {
  const out: Partial<StoryContent> = { ...content };
  for (const key of ['behaviour', 'alternativeFlows', 'acceptanceCriteria', 'errorScenarios'] as const) {
    if (out[key]) out[key] = nonEmptyItems(out[key]);
  }
  for (const key of ['fieldIds', 'validationRuleIds', 'businessRuleIds', 'implementsIds', 'dependsOnIds'] as const) {
    if (out[key]) out[key] = dedupe(out[key]);
  }
  if (out.activities) out.activities = [...new Map(out.activities.map((a) => [activityKey(a), a])).values()];
  if (out.title !== undefined) out.title = out.title.trim();
  return out;
}

async function newStory(ctx: OpContext, projectId: string, input: z.output<typeof NewStorySchema>, stories: Story[], context: ProjectContext): Promise<Story> {
  const t = ctx.now();
  const content = { ...EMPTY_STORY_CONTENT, ...normaliseContent(input.content) };
  if (!content.title) fail('Give the story a title', 'PF422');
  const designStatus =
    input.storyType === 'functional' ? 'confirmed' : (input.designStatus ?? (input.origin === 'manual' ? 'confirmed' : 'proposed'));
  const story: Story = {
    ...content,
    id: ctx.newId(),
    projectId,
    refCode: '',
    storyType: input.storyType,
    status: 'draft',
    origin: input.origin,
    version: 1,
    designStatus,
    priority: 'medium',
    businessValue: null,
    storyPoints: null,
    originalEstimateHours: null,
    estimateHours: null,
    remainingHours: null,
    actualHours: 0,
    assigneeId: null,
    backlogRank: 0,
    workStatus: 'todo',
    blocked: false,
    blockedReason: '',
    reviewFlag: null,
    startedAt: null,
    completedAt: null,
    createdBy: ctx.userId,
    createdAt: t,
    updatedAt: t,
    revision: 1,
  };
  await checkStoryLinks(ctx, story, stories, context);
  story.refCode = await ctx.store.nextRef(projectId, input.storyType === 'functional' ? 'US' : 'TS');
  await ctx.store.insert('stories', story);
  await recordEvent(ctx, projectId, 'story', story.id, 'created', { body: input.origin === 'manual' ? '' : 'Accepted from an AI proposal' });
  return story;
}

function scenarioFrom(ctx: OpContext, content: ScenarioContent): ScenarioContent {
  return {
    ...content,
    title: content.title.trim(),
    preconditions: nonEmptyItems(content.preconditions),
    steps: content.steps.filter((s) => s.action.trim() || s.expectedResult.trim()),
    storyIds: dedupe(content.storyIds),
    activities: [...new Map(content.activities.map((a) => [activityKey(a), a])).values()],
  };
}

async function checkScenarioLinks(ctx: OpContext, projectId: string, content: ScenarioContent) {
  if (!content.title) fail('Give the scenario a title', 'PF422');
  const stories = await ctx.store.list('stories', projectId);
  const technical = new Set(stories.filter((s) => s.storyType === 'technical').map((s) => s.id));
  if (content.storyIds.some((id) => !technical.has(id))) fail('A scenario can only be linked to technical stories in this project', 'PF422');
  const context = await ctx.store.context(projectId);
  if (content.processId && !context.processes.some((p) => p.id === content.processId)) fail('That process is not in this project', 'PF422');
  const index = activityIndex(context);
  if (content.activities.some((a) => !index.has(activityKey(a)))) fail('A linked activity is not in this project', 'PF422');
}

function checkAttachments(attachments: { dataUrl: string }[]) {
  for (const a of attachments) {
    if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(a.dataUrl)) fail('Attachments must be PNG, JPEG, GIF or WebP images', 'PF422');
    if (Math.floor(((a.dataUrl.length - a.dataUrl.indexOf(',') - 1) * 3) / 4) > MAX_ATTACHMENT_BYTES) {
      fail(`Each screenshot must be ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB or smaller`, 'PF422');
    }
  }
}

/** The open (planned or active) sprint a story is allocated to, if any. */
async function openSprintOf(ctx: OpContext, story: Story): Promise<{ item: SprintItem; sprint: Sprint } | null> {
  const items = (await ctx.store.list('sprintItems', story.projectId)).filter((i) => i.storyId === story.id && i.removedAt === null);
  const sprints = await ctx.store.list('sprints', story.projectId);
  for (const status of ['active', 'planned'] as const) {
    for (const item of items) {
      const sprint = sprints.find((s) => s.id === item.sprintId && s.status === status);
      if (sprint) return { item, sprint };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

interface Op<S extends z.ZodType, R> {
  input: S;
  run(ctx: OpContext, input: z.output<S>): Promise<R>;
}
const op = <S extends z.ZodType, R>(input: S, run: (ctx: OpContext, input: z.output<S>) => Promise<R>): Op<S, R> => ({ input, run });

export interface StoryProposal {
  runId: string;
  model: string;
  stories: { storyType: StoryType; content: StoryContent; origin: 'stated' | 'inferred'; assumptions: string[] }[];
  questions: string[];
}

export interface ScenarioProposal {
  runId: string;
  model: string;
  scenarios: ScenarioContent[];
  questions: string[];
}

export interface RefinementProposal {
  runId: string;
  model: string;
  refinement: Refinement;
}

export interface ChangeImpactResult {
  fromVersion: { id: string; versionNumber: number } | null;
  toVersion: { id: string; versionNumber: number } | null;
  impact: ChangeImpact;
  assessment: ChangeImpactAssessment | null;
  runId: string | null;
  model: string | null;
}

export const DELIVERY_OPS = {
  snapshot: op(z.strictObject({ projectId: Id }), async (ctx, { projectId }) => {
    await roleIn(ctx, projectId);
    return loadSnapshot(ctx, projectId);
  }),

  /** Processes, activities, the data dictionary, rules and members: what the delivery screens link to. */
  projectContext: op(z.strictObject({ projectId: Id }), async (ctx, { projectId }) => {
    await roleIn(ctx, projectId);
    return ctx.store.context(projectId);
  }),

  updateSettings: op(
    z.strictObject({
      projectId: Id,
      revision: z.number().int().min(0),
      patch: z
        .strictObject({
          strictWorkflow: z.boolean(),
          allowConcurrentSprints: z.boolean(),
          requireEstimateForDevelopment: z.boolean(),
          defaultSprintCapacityHours: Hours,
        })
        .partial(),
    }),
    async (ctx, { projectId, revision, patch }) => {
      await requirePermission(ctx, projectId, 'manageSettings', 'Only project administrators can change delivery settings');
      const current = await settingsFor(ctx, projectId);
      const next = { ...current, ...patch, revision: revision + 1 };
      if (!(await ctx.store.saveSettings(next, revision))) fail('Settings were changed by someone else. Reload and try again.', 'PF409');
      return next;
    },
  ),

  // ----- Stories ------------------------------------------------------------

  createStory: op(NewStorySchema.extend({ projectId: Id }), async (ctx, input) => {
    const role = await roleIn(ctx, input.projectId);
    if (!canEditStory(role, input)) fail(`You do not have permission to write ${input.storyType} stories`, '42501');
    const [stories, context] = await Promise.all([ctx.store.list('stories', input.projectId), ctx.store.context(input.projectId)]);
    return newStory(ctx, input.projectId, input, stories, context);
  }),

  createStories: op(z.strictObject({ projectId: Id, stories: z.array(NewStorySchema).min(1).max(50) }), async (ctx, input) => {
    const role = await roleIn(ctx, input.projectId);
    for (const s of input.stories) if (!canEditStory(role, s)) fail(`You do not have permission to write ${s.storyType} stories`, '42501');
    const [stories, context] = await Promise.all([ctx.store.list('stories', input.projectId), ctx.store.context(input.projectId)]);
    const created: Story[] = [];
    for (const s of input.stories) created.push(await newStory(ctx, input.projectId, s, [...stories, ...created], context));
    return created;
  }),

  updateStory: op(
    z.strictObject({ storyId: Id, revision: z.number().int(), content: StoryContentSchema.partial(), designStatus: z.enum(DESIGN_STATUSES).optional() }),
    async (ctx, { storyId, revision, content, designStatus }) => {
      const story = await load(ctx, 'stories', storyId);
      const role = await roleIn(ctx, story.projectId);
      if (!canEditStory(role, story)) fail('You do not have permission to edit this story', '42501');
      checkRevision(story, revision);
      if (story.status !== 'draft') fail(`${story.refCode} is ${story.status.replace('_', ' ')}. Return it to draft before changing it.`, 'PF423');
      if (designStatus && designStatus !== story.designStatus && story.storyType === 'technical') {
        if (designStatus === 'confirmed' && role !== 'developer' && role !== 'admin') {
          fail('Only a Developer or Administrator can confirm a technical design', '42501');
        }
      }
      const next: Story = { ...story, ...normaliseContent(content), designStatus: story.storyType === 'technical' ? (designStatus ?? story.designStatus) : 'confirmed' };
      if (!next.title) fail('Give the story a title', 'PF422');
      const [stories, context] = await Promise.all([ctx.store.list('stories', story.projectId), ctx.store.context(story.projectId)]);
      await checkStoryLinks(ctx, next, stories, context);
      const saved = await save(ctx, 'stories', next, revision);
      if (designStatus === 'confirmed' && story.designStatus === 'proposed') {
        await recordEvent(ctx, story.projectId, 'story', story.id, 'edit', { body: 'Technical design confirmed' });
      }
      return saved;
    },
  ),

  setStoryStatus: op(
    z.strictObject({ storyId: Id, revision: z.number().int(), status: z.enum(STORY_STATUSES), comment: z.string().max(2000).default('') }),
    async (ctx, { storyId, revision, status, comment }) => {
      const story = await load(ctx, 'stories', storyId);
      const role = await roleIn(ctx, story.projectId);
      checkRevision(story, revision);
      const open = await openSprintOf(ctx, story);
      const problem = checkStoryStatusChange(story, status, role, open !== null);
      if (problem) fail(problem, problem.startsWith('Only') || problem.includes('permission') ? '42501' : 'PF422');
      const next: Story = { ...story, status };
      if (status === 'in_backlog') {
        const stories = await ctx.store.list('stories', story.projectId);
        next.backlogRank = Math.max(0, ...stories.filter((s) => s.status === 'in_backlog').map((s) => s.backlogRank)) + 1;
        next.workStatus = 'todo';
      }
      if (status === 'draft' && (story.status === 'approved' || story.status === 'in_backlog')) next.version = story.version + 1;
      const saved = await save(ctx, 'stories', next, revision);
      await recordEvent(ctx, story.projectId, 'story', story.id, 'status', { from: story.status, to: status, body: comment.trim() });
      return saved;
    },
  ),

  deleteStory: op(z.strictObject({ storyId: Id }), async (ctx, { storyId }) => {
    const story = await load(ctx, 'stories', storyId);
    const role = await roleIn(ctx, story.projectId);
    if (!canEditStory(role, story)) fail('You do not have permission to delete this story', '42501');
    if (story.status !== 'draft') fail(`${story.refCode} has been submitted. Only draft stories can be deleted.`, 'PF423');
    const stories = await ctx.store.list('stories', story.projectId);
    const users = stories.filter((s) => s.implementsIds.includes(storyId) || s.dependsOnIds.includes(storyId));
    if (users.length) fail(`${story.refCode} is linked from ${users.map((s) => s.refCode).join(', ')}. Remove those links first.`, 'PF423');
    const scenarios = (await ctx.store.list('scenarios', story.projectId)).filter((s) => s.storyIds.includes(storyId));
    if (scenarios.length) fail(`${story.refCode} is tested by ${scenarios.map((s) => s.refCode).join(', ')}. Remove those links first.`, 'PF423');
    await ctx.store.remove('stories', storyId);
  }),

  updateBacklog: op(
    z.strictObject({
      storyId: Id,
      revision: z.number().int(),
      patch: z
        .strictObject({
          priority: z.enum(PRIORITIES),
          businessValue: z.number().int().min(1).max(10).nullable(),
          storyPoints: z.number().min(0).max(1000).nullable(),
          estimateHours: Hours.nullable(),
          assigneeId: Id.nullable(),
        })
        .partial(),
    }),
    async (ctx, { storyId, revision, patch }) => {
      const story = await load(ctx, 'stories', storyId);
      const role = await roleIn(ctx, story.projectId);
      checkRevision(story, revision);
      const planning = patch.priority !== undefined || patch.businessValue !== undefined;
      if (planning && !canDeliver(role, 'manageBacklog')) fail('Only a Product Owner or Administrator can prioritise the backlog', '42501');
      const estimating = patch.storyPoints !== undefined || patch.estimateHours !== undefined || patch.assigneeId !== undefined;
      if (estimating && !canDeliver(role, 'updateWork')) fail('Only Developers, Product Owners and Administrators can estimate or assign stories', '42501');
      if (story.status !== 'approved' && story.status !== 'in_backlog') fail(`${story.refCode} must be approved before it is planned`, 'PF423');
      await checkMember(ctx, story.projectId, patch.assigneeId);
      const next: Story = { ...story, ...patch };
      if (patch.estimateHours !== undefined && patch.estimateHours !== null) {
        if (story.originalEstimateHours === null) next.originalEstimateHours = patch.estimateHours;
        if (story.remainingHours === null) next.remainingHours = patch.estimateHours;
      }
      const saved = await save(ctx, 'stories', next, revision);
      if (patch.assigneeId !== undefined && patch.assigneeId !== story.assigneeId) {
        await recordEvent(ctx, story.projectId, 'story', story.id, 'assignment', { from: story.assigneeId, to: patch.assigneeId });
      }
      if (patch.estimateHours !== undefined && patch.estimateHours !== story.estimateHours) {
        await recordEvent(ctx, story.projectId, 'story', story.id, 'edit', {
          body: `Estimate ${story.estimateHours ?? '–'} h → ${patch.estimateHours ?? '–'} h`,
        });
      }
      return saved;
    },
  ),

  reorderBacklog: op(z.strictObject({ projectId: Id, storyIds: Ids }), async (ctx, { projectId, storyIds }) => {
    await requirePermission(ctx, projectId, 'manageBacklog', 'Only a Product Owner or Administrator can prioritise the backlog');
    const stories = new Map((await ctx.store.list('stories', projectId)).map((s) => [s.id, s]));
    let rank = 1;
    for (const id of storyIds) {
      const story = stories.get(id);
      if (!story) fail('A story in the new order is not in this project', 'PF422');
      if (story!.backlogRank !== rank) await save(ctx, 'stories', { ...story!, backlogRank: rank }, story!.revision);
      rank += 1;
    }
  }),

  moveStory: op(z.strictObject({ storyId: Id, revision: z.number().int(), to: z.enum(WORK_STATUSES) }), async (ctx, { storyId, revision, to }) => {
    const story = await load(ctx, 'stories', storyId);
    const role = await roleIn(ctx, story.projectId);
    checkRevision(story, revision);
    const [settings, open, stories] = await Promise.all([settingsFor(ctx, story.projectId), openSprintOf(ctx, story), ctx.store.list('stories', story.projectId)]);
    const problem = checkWorkMove(story, to, role, {
      settings,
      sprint: open?.sprint ?? null,
      dependencies: stories.filter((s) => story.dependsOnIds.includes(s.id)),
    });
    if (problem) fail(problem, problem.startsWith('Only') ? '42501' : 'PF422');
    if (to === story.workStatus) return story;
    const next = applyWorkMove(story, to, ctx.now());
    const saved = await save(ctx, 'stories', next, revision);
    await recordEvent(ctx, story.projectId, 'story', story.id, 'work_status', { from: story.workStatus, to });
    if (next.remainingHours !== story.remainingHours) {
      await recordEvent(ctx, story.projectId, 'story', story.id, 'effort', { from: String(story.remainingHours ?? ''), to: String(next.remainingHours), body: 'Completed' });
    }
    return saved;
  }),

  updateEffort: op(
    z.strictObject({ storyId: Id, revision: z.number().int(), remainingHours: Hours.optional(), actualHours: Hours.optional(), note: z.string().max(500).default('') }),
    async (ctx, { storyId, revision, remainingHours, actualHours, note }) => {
      const story = await load(ctx, 'stories', storyId);
      await requirePermission(ctx, story.projectId, 'updateWork', 'Only Developers, Product Owners and Administrators can update effort');
      checkRevision(story, revision);
      if (story.status !== 'in_backlog') fail(`${story.refCode} is not in the backlog`, 'PF423');
      const next = { ...story, remainingHours: remainingHours ?? story.remainingHours, actualHours: actualHours ?? story.actualHours };
      const saved = await save(ctx, 'stories', next, revision);
      const parts = [
        remainingHours !== undefined && remainingHours !== story.remainingHours ? `Remaining ${story.remainingHours ?? '–'} h → ${remainingHours} h` : '',
        actualHours !== undefined && actualHours !== story.actualHours ? `Actual ${story.actualHours} h → ${actualHours} h` : '',
        note.trim(),
      ].filter(Boolean);
      if (parts.length) {
        await recordEvent(ctx, story.projectId, 'story', story.id, 'effort', {
          from: String(story.remainingHours ?? ''),
          to: String(next.remainingHours ?? ''),
          body: parts.join('. '),
        });
      }
      return saved;
    },
  ),

  setBlocked: op(
    z.strictObject({ storyId: Id, revision: z.number().int(), blocked: z.boolean(), reason: z.string().max(1000).default('') }),
    async (ctx, { storyId, revision, blocked, reason }) => {
      const story = await load(ctx, 'stories', storyId);
      await requirePermission(ctx, story.projectId, 'updateWork', 'Only Developers, Product Owners and Administrators can block stories');
      checkRevision(story, revision);
      if (blocked && !reason.trim()) fail('Say what the story is blocked by', 'PF422');
      const saved = await save(ctx, 'stories', { ...story, blocked, blockedReason: blocked ? reason.trim() : '' }, revision);
      await recordEvent(ctx, story.projectId, 'story', story.id, 'flag', { to: blocked ? 'blocked' : 'unblocked', body: reason.trim() });
      return saved;
    },
  ),

  clearReviewFlag: op(z.strictObject({ entityType: z.enum(['story', 'scenario']), id: Id, note: z.string().max(1000).default('') }), async (ctx, { entityType, id, note }) => {
    if (entityType === 'story') {
      const story = await load(ctx, 'stories', id);
      const role = await roleIn(ctx, story.projectId);
      if (!canEditStory(role, story) && !canDeliver(role, 'reviewStory')) fail('You do not have permission to review this story', '42501');
      await save(ctx, 'stories', { ...story, reviewFlag: null }, story.revision);
      await recordEvent(ctx, story.projectId, 'story', id, 'flag', { from: story.reviewFlag, to: 'reviewed', body: note.trim() });
    } else {
      const scenario = await load(ctx, 'scenarios', id);
      await requirePermission(ctx, scenario.projectId, 'editScenarios', 'You do not have permission to review this scenario');
      await save(ctx, 'scenarios', { ...scenario, reviewFlag: null }, scenario.revision);
      await recordEvent(ctx, scenario.projectId, 'scenario', id, 'flag', { from: scenario.reviewFlag, to: 'reviewed', body: note.trim() });
    }
  }),

  addComment: op(z.strictObject({ entityType: z.enum(EVENT_ENTITIES), entityId: Id, body: z.string().trim().min(1, 'Write a comment first').max(4000) }), async (ctx, { entityType, entityId, body }) => {
    const kind = ({ story: 'stories', sprint: 'sprints', scenario: 'scenarios', execution: 'executions', defect: 'defects' } as const)[entityType];
    const entity = await load(ctx, kind, entityId);
    await recordEvent(ctx, entity.projectId, entityType, entityId, 'comment', { body });
  }),

  // ----- Sprints ------------------------------------------------------------

  createSprint: op(SprintFieldsSchema.extend({ projectId: Id }), async (ctx, input) => {
    await requirePermission(ctx, input.projectId, 'manageBacklog', 'Only a Product Owner or Administrator can plan sprints');
    if (!input.name.trim()) fail('Give the sprint a name', 'PF422');
    if (input.endDate < input.startDate) fail('The sprint must end on or after its start date', 'PF422');
    const sprint: Sprint = {
      id: ctx.newId(),
      projectId: input.projectId,
      refCode: await ctx.store.nextRef(input.projectId, 'SPR'),
      name: input.name.trim(),
      objective: input.objective.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'planned',
      capacityHours: input.capacityHours,
      team: input.team.trim(),
      startedAt: null,
      completedAt: null,
      createdAt: ctx.now(),
      revision: 1,
    };
    await ctx.store.insert('sprints', sprint);
    await recordEvent(ctx, input.projectId, 'sprint', sprint.id, 'created');
    return sprint;
  }),

  updateSprint: op(SprintFieldsSchema.extend({ sprintId: Id, revision: z.number().int() }), async (ctx, { sprintId, revision, ...fields }) => {
    const sprint = await load(ctx, 'sprints', sprintId);
    await requirePermission(ctx, sprint.projectId, 'manageBacklog', 'Only a Product Owner or Administrator can plan sprints');
    checkRevision(sprint, revision);
    if (sprint.status === 'completed' || sprint.status === 'cancelled') fail(`${sprint.name} is ${sprint.status} and cannot be changed`, 'PF423');
    if (fields.endDate < fields.startDate) fail('The sprint must end on or after its start date', 'PF422');
    if (sprint.status === 'active' && fields.startDate !== sprint.startDate) fail('The start date of an active sprint cannot change', 'PF423');
    return save(ctx, 'sprints', { ...sprint, ...fields, name: fields.name.trim() || sprint.name }, revision);
  }),

  setSprintStatus: op(z.strictObject({ sprintId: Id, revision: z.number().int(), status: z.enum(SPRINT_STATUSES) }), async (ctx, { sprintId, revision, status }) => {
    const sprint = await load(ctx, 'sprints', sprintId);
    await requirePermission(ctx, sprint.projectId, 'manageBacklog', 'Only a Product Owner or Administrator can start or close sprints');
    checkRevision(sprint, revision);
    const [sprints, settings] = await Promise.all([ctx.store.list('sprints', sprint.projectId), settingsFor(ctx, sprint.projectId)]);
    const problem = checkSprintStatusChange(sprint, status, sprints.filter((s) => s.status === 'active'), settings.allowConcurrentSprints);
    if (problem) fail(problem, 'PF422');
    const t = ctx.now();
    const next: Sprint = { ...sprint, status };
    if (status === 'active') next.startedAt = t;
    if (status === 'completed' || status === 'cancelled') next.completedAt = t;
    const saved = await save(ctx, 'sprints', next, revision);
    await recordEvent(ctx, sprint.projectId, 'sprint', sprint.id, 'status', { from: sprint.status, to: status });
    return saved;
  }),

  addToSprint: op(
    z.strictObject({ sprintId: Id, storyId: Id, plannedHours: Hours.optional(), assigneeId: Id.nullable().optional(), plannedStart: IsoDate.nullable().default(null), plannedEnd: IsoDate.nullable().default(null) }),
    async (ctx, input) => {
      const sprint = await load(ctx, 'sprints', input.sprintId);
      await requirePermission(ctx, sprint.projectId, 'manageBacklog', 'Only a Product Owner or Administrator can plan sprints');
      const story = await load(ctx, 'stories', input.storyId);
      if (story.projectId !== sprint.projectId) fail('The story is not in this project', 'PF422');
      if (story.status !== 'in_backlog') fail(`${story.refCode} must be in the backlog before it is planned into a sprint`, 'PF422');
      if (sprint.status !== 'planned' && sprint.status !== 'active') fail(`${sprint.name} is ${sprint.status}`, 'PF423');
      if (story.workStatus === 'completed') fail(`${story.refCode} is already completed`, 'PF422');
      const open = await openSprintOf(ctx, story);
      if (open) fail(`${story.refCode} is already planned in ${open.sprint.name}`, 'PF409');
      await checkMember(ctx, sprint.projectId, input.assigneeId);
      const item: SprintItem = {
        id: ctx.newId(),
        projectId: sprint.projectId,
        sprintId: sprint.id,
        storyId: story.id,
        plannedHours: input.plannedHours ?? story.remainingHours ?? story.estimateHours ?? 0,
        assigneeId: input.assigneeId === undefined ? story.assigneeId : input.assigneeId,
        plannedStart: input.plannedStart,
        plannedEnd: input.plannedEnd,
        committed: sprint.status === 'planned',
        addedAt: ctx.now(),
        removedAt: null,
      };
      await ctx.store.insert('sprintItems', item);
      if (item.assigneeId && !story.assigneeId) await save(ctx, 'stories', { ...story, assigneeId: item.assigneeId }, story.revision);
      await recordEvent(ctx, sprint.projectId, 'story', story.id, 'edit', { body: `Planned into ${sprint.name}${item.committed ? '' : ' after it started'}` });
      return item;
    },
  ),

  updateSprintItem: op(
    z.strictObject({ itemId: Id, plannedHours: Hours, assigneeId: Id.nullable(), plannedStart: IsoDate.nullable(), plannedEnd: IsoDate.nullable() }),
    async (ctx, { itemId, ...patch }) => {
      const item = await load(ctx, 'sprintItems', itemId);
      await requirePermission(ctx, item.projectId, 'manageBacklog', 'Only a Product Owner or Administrator can plan sprints');
      if (item.removedAt) fail('This story was taken out of the sprint', 'PF423');
      await checkMember(ctx, item.projectId, patch.assigneeId);
      if (patch.plannedStart && patch.plannedEnd && patch.plannedEnd < patch.plannedStart) fail('Planned completion must be on or after the planned start', 'PF422');
      const next = { ...item, ...patch };
      await ctx.store.update('sprintItems', next);
      return next;
    },
  ),

  removeFromSprint: op(z.strictObject({ itemId: Id }), async (ctx, { itemId }) => {
    const item = await load(ctx, 'sprintItems', itemId);
    await requirePermission(ctx, item.projectId, 'manageBacklog', 'Only a Product Owner or Administrator can plan sprints');
    if (item.removedAt) return item;
    const sprint = await load(ctx, 'sprints', item.sprintId);
    if (sprint.status === 'completed' || sprint.status === 'cancelled') fail(`${sprint.name} is ${sprint.status}`, 'PF423');
    const next = { ...item, removedAt: ctx.now() };
    await ctx.store.update('sprintItems', next);
    await recordEvent(ctx, item.projectId, 'story', item.storyId, 'edit', { body: `Removed from ${sprint.name}` });
    return next;
  }),

  // ----- Business scenarios -----------------------------------------------------

  createScenarios: op(z.strictObject({ projectId: Id, scenarios: z.array(NewScenarioSchema).min(1).max(50) }), async (ctx, { projectId, scenarios }) => {
    await requirePermission(ctx, projectId, 'editScenarios', 'Only Business Analysts and Administrators can write test scenarios');
    const created: BusinessScenario[] = [];
    for (const input of scenarios) {
      const content = scenarioFrom(ctx, input.content);
      await checkScenarioLinks(ctx, projectId, content);
      const t = ctx.now();
      const scenario: BusinessScenario = {
        ...content,
        id: ctx.newId(),
        projectId,
        refCode: await ctx.store.nextRef(projectId, 'BS'),
        prerequisitesMet: false,
        status: 'draft',
        origin: input.origin,
        version: 1,
        reviewFlag: null,
        createdBy: ctx.userId,
        createdAt: t,
        updatedAt: t,
        revision: 1,
      };
      await ctx.store.insert('scenarios', scenario);
      await recordEvent(ctx, projectId, 'scenario', scenario.id, 'created');
      created.push(scenario);
    }
    return created;
  }),

  updateScenario: op(z.strictObject({ scenarioId: Id, revision: z.number().int(), content: ScenarioContentSchema }), async (ctx, { scenarioId, revision, content }) => {
    const scenario = await load(ctx, 'scenarios', scenarioId);
    await requirePermission(ctx, scenario.projectId, 'editScenarios', 'Only Business Analysts and Administrators can edit test scenarios');
    checkRevision(scenario, revision);
    if (scenario.status !== 'draft') fail(`${scenario.refCode} is approved. Return it to draft before changing it.`, 'PF423');
    const next = scenarioFrom(ctx, content);
    await checkScenarioLinks(ctx, scenario.projectId, next);
    return save(ctx, 'scenarios', { ...scenario, ...next, version: scenario.version + 1 }, revision);
  }),

  setScenarioStatus: op(z.strictObject({ scenarioId: Id, revision: z.number().int(), status: z.enum(SCENARIO_STATUSES) }), async (ctx, { scenarioId, revision, status }) => {
    const scenario = await load(ctx, 'scenarios', scenarioId);
    const role = await roleIn(ctx, scenario.projectId);
    checkRevision(scenario, revision);
    if (scenario.status === status) return scenario;
    if (status === 'approved') {
      if (!canDeliver(role, 'approveScenario')) fail('Only a Product Owner or Administrator can approve a test scenario', '42501');
      if (scenario.steps.length === 0 || scenario.steps.some((s) => !s.expectedResult.trim())) {
        fail(`Every step of ${scenario.refCode} needs an expected result before it is approved`, 'PF422');
      }
    } else {
      if (!canDeliver(role, 'editScenarios') && !canDeliver(role, 'approveScenario')) fail('You do not have permission to change this scenario', '42501');
      const running = (await ctx.store.list('executions', scenario.projectId)).some((e) => e.scenarioId === scenarioId && e.status === 'in_progress');
      if (running) fail(`${scenario.refCode} is being tested. Finish that test first.`, 'PF423');
    }
    const saved = await save(ctx, 'scenarios', { ...scenario, status }, revision);
    await recordEvent(ctx, scenario.projectId, 'scenario', scenarioId, 'status', { from: scenario.status, to: status });
    return saved;
  }),

  setPrerequisites: op(z.strictObject({ scenarioId: Id, revision: z.number().int(), prerequisites: LongText, met: z.boolean() }), async (ctx, { scenarioId, revision, prerequisites, met }) => {
    const scenario = await load(ctx, 'scenarios', scenarioId);
    const role = await roleIn(ctx, scenario.projectId);
    if (!canDeliver(role, 'editScenarios') && !canDeliver(role, 'executeTests')) fail('You do not have permission to change prerequisites', '42501');
    checkRevision(scenario, revision);
    const saved = await save(ctx, 'scenarios', { ...scenario, prerequisites: prerequisites.trim(), prerequisitesMet: met }, revision);
    if (met !== scenario.prerequisitesMet) {
      await recordEvent(ctx, scenario.projectId, 'scenario', scenarioId, 'flag', { to: met ? 'prerequisites met' : 'prerequisites not met' });
    }
    return saved;
  }),

  deleteScenario: op(z.strictObject({ scenarioId: Id }), async (ctx, { scenarioId }) => {
    const scenario = await load(ctx, 'scenarios', scenarioId);
    await requirePermission(ctx, scenario.projectId, 'editScenarios', 'Only Business Analysts and Administrators can delete test scenarios');
    if (scenario.status !== 'draft') fail('Only draft scenarios can be deleted', 'PF423');
    if ((await ctx.store.list('executions', scenario.projectId)).some((e) => e.scenarioId === scenarioId)) {
      fail(`${scenario.refCode} has test history and cannot be deleted`, 'PF423');
    }
    await ctx.store.remove('scenarios', scenarioId);
  }),

  // ----- UAT executions -------------------------------------------------------

  startExecution: op(z.strictObject({ scenarioId: Id }), async (ctx, { scenarioId }) => {
    const scenario = await load(ctx, 'scenarios', scenarioId);
    await requirePermission(ctx, scenario.projectId, 'executeTests', 'Only Business Users, Analysts, Product Owners and Administrators run UAT');
    const [stories, executions] = await Promise.all([ctx.store.list('stories', scenario.projectId), ctx.store.list('executions', scenario.projectId)]);
    const readiness = scenarioReadiness(scenario, new Map(stories.map((s) => [s.id, s])));
    if (!readiness.ready) fail(`${scenario.refCode} is not ready for testing: ${readiness.reasons.join('; ')}`, 'PF422');
    const running = executions.find((e) => e.scenarioId === scenarioId && e.status === 'in_progress');
    if (running) fail(`${running.refCode} is already testing ${scenario.refCode}. Continue that test instead.`, 'PF409');
    const execution: TestExecution = {
      id: ctx.newId(),
      projectId: scenario.projectId,
      refCode: await ctx.store.nextRef(scenario.projectId, 'TE'),
      scenarioId,
      scenarioVersion: scenario.version,
      steps: scenario.steps,
      results: scenario.steps.map((s) => ({ stepId: s.id, status: 'not_tested', testData: s.inputData, actualResult: '', remarks: '' })),
      status: 'in_progress',
      testerId: ctx.userId,
      remarks: '',
      startedAt: ctx.now(),
      completedAt: null,
      revision: 1,
    };
    await ctx.store.insert('executions', execution);
    await recordEvent(ctx, scenario.projectId, 'execution', execution.id, 'created', { body: `Testing ${scenario.refCode} v${scenario.version}` });
    return execution;
  }),

  recordStepResult: op(
    z.strictObject({ executionId: Id, revision: z.number().int(), stepId: Id, status: z.enum(STEP_RESULTS), testData: z.string().max(2000), actualResult: z.string().max(4000), remarks: z.string().max(4000) }),
    async (ctx, { executionId, revision, stepId, ...result }) => {
      const execution = await load(ctx, 'executions', executionId);
      await requirePermission(ctx, execution.projectId, 'executeTests', 'You do not have permission to record test results');
      checkRevision(execution, revision);
      if (execution.status !== 'in_progress') fail(`${execution.refCode} is completed. Test history cannot be changed; start a new test instead.`, 'PF423');
      if (!execution.results.some((r) => r.stepId === stepId)) fail('That step is not part of this test', 'PF422');
      if (result.status === 'fail' && !result.actualResult.trim()) fail('Describe the actual result of a failed step', 'PF422');
      return save(ctx, 'executions', { ...execution, results: execution.results.map((r) => (r.stepId === stepId ? { stepId, ...result } : r)) }, revision);
    },
  ),

  completeExecution: op(z.strictObject({ executionId: Id, revision: z.number().int(), remarks: z.string().max(4000).default('') }), async (ctx, { executionId, revision, remarks }) => {
    const execution = await load(ctx, 'executions', executionId);
    await requirePermission(ctx, execution.projectId, 'executeTests', 'You do not have permission to complete tests');
    checkRevision(execution, revision);
    if (execution.status !== 'in_progress') fail(`${execution.refCode} is already completed`, 'PF423');
    const outcome = executionOutcome(execution.results);
    if ('error' in outcome) return fail(outcome.error, 'PF422');
    const saved = await save(ctx, 'executions', { ...execution, status: outcome.status, remarks: remarks.trim(), completedAt: ctx.now() }, revision);
    await recordEvent(ctx, execution.projectId, 'execution', executionId, 'status', { from: 'in_progress', to: outcome.status });
    return saved;
  }),

  // ----- Defects --------------------------------------------------------------

  createDefect: op(
    DefectFieldsSchema.partial().extend({ projectId: Id, title: ShortText, severity: z.enum(DEFECT_SEVERITIES), executionId: Id.optional(), stepId: Id.optional() }),
    async (ctx, input) => {
      await roleIn(ctx, input.projectId);
      if (!input.title.trim()) fail('Give the defect a title', 'PF422');
      let scenarioId: string | null = null;
      let expected = input.expectedResult ?? '';
      let actual = input.actualResult ?? '';
      let remarks = input.remarks ?? '';
      let storyIds = input.storyIds ?? [];
      if (input.executionId) {
        const execution = await load(ctx, 'executions', input.executionId);
        if (execution.projectId !== input.projectId) fail('That test is not in this project', 'PF422');
        const step = execution.steps.find((s) => s.id === input.stepId);
        const result = execution.results.find((r) => r.stepId === input.stepId);
        if (!step || !result) fail('Choose the failed step the defect was found in', 'PF422');
        if (result!.status !== 'fail') fail('Defects are raised from failed steps', 'PF422');
        const scenario = await ctx.store.get('scenarios', execution.scenarioId);
        scenarioId = execution.scenarioId;
        expected = expected || step!.expectedResult;
        actual = actual || result!.actualResult;
        remarks = remarks || result!.remarks;
        if (!input.storyIds) storyIds = scenario?.storyIds ?? [];
      }
      const stories = new Set((await ctx.store.list('stories', input.projectId)).map((s) => s.id));
      if (storyIds.some((id) => !stories.has(id))) fail('A linked story is not in this project', 'PF422');
      await checkMember(ctx, input.projectId, input.assigneeId);
      checkAttachments(input.attachments ?? []);
      if (input.sprintId) {
        const sprint = await ctx.store.get('sprints', input.sprintId);
        if (!sprint || sprint.projectId !== input.projectId) fail('That sprint is not in this project', 'PF422');
      }
      const defect: Defect = {
        id: ctx.newId(),
        projectId: input.projectId,
        refCode: await ctx.store.nextRef(input.projectId, 'DEF'),
        title: input.title.trim(),
        description: input.description ?? '',
        severity: input.severity,
        priority: input.priority ?? 'medium',
        status: input.assigneeId ? 'assigned' : 'open',
        scenarioId,
        executionId: input.executionId ?? null,
        stepId: input.stepId ?? null,
        expectedResult: expected,
        actualResult: actual,
        remarks,
        storyIds: dedupe(storyIds),
        assigneeId: input.assigneeId ?? null,
        sprintId: input.sprintId ?? null,
        attachments: input.attachments ?? [],
        createdBy: ctx.userId,
        createdAt: ctx.now(),
        resolvedAt: null,
        revision: 1,
      };
      await ctx.store.insert('defects', defect);
      await recordEvent(ctx, input.projectId, 'defect', defect.id, 'created');
      return defect;
    },
  ),

  updateDefect: op(z.strictObject({ defectId: Id, revision: z.number().int(), patch: DefectFieldsSchema.partial() }), async (ctx, { defectId, revision, patch }) => {
    const defect = await load(ctx, 'defects', defectId);
    const role = await roleIn(ctx, defect.projectId);
    checkRevision(defect, revision);
    if (defect.status === 'closed') fail(`${defect.refCode} is closed. Reopen it to change it.`, 'PF423');
    const mayEdit = defect.createdBy === ctx.userId || canDeliver(role, 'workDefect') || canDeliver(role, 'verifyDefect');
    if (!mayEdit) fail('You do not have permission to edit this defect', '42501');
    if (patch.assigneeId !== undefined && patch.assigneeId !== defect.assigneeId && !canDeliver(role, 'workDefect')) {
      fail('Only Developers, Product Owners and Administrators can assign defects', '42501');
    }
    await checkMember(ctx, defect.projectId, patch.assigneeId);
    if (patch.attachments) checkAttachments(patch.attachments);
    if (patch.storyIds) {
      const stories = new Set((await ctx.store.list('stories', defect.projectId)).map((s) => s.id));
      if (patch.storyIds.some((id) => !stories.has(id))) fail('A linked story is not in this project', 'PF422');
    }
    const next: Defect = { ...defect, ...patch };
    if (defect.status === 'open' && next.assigneeId) next.status = 'assigned';
    const saved = await save(ctx, 'defects', next, revision);
    if (next.assigneeId !== defect.assigneeId) {
      await recordEvent(ctx, defect.projectId, 'defect', defectId, 'assignment', { from: defect.assigneeId, to: next.assigneeId });
    }
    if (next.status !== defect.status) await recordEvent(ctx, defect.projectId, 'defect', defectId, 'status', { from: defect.status, to: next.status });
    return saved;
  }),

  setDefectStatus: op(
    z.strictObject({ defectId: Id, revision: z.number().int(), status: z.enum(DEFECT_STATUSES), comment: z.string().max(2000).default('') }),
    async (ctx, { defectId, revision, status, comment }) => {
      const defect = await load(ctx, 'defects', defectId);
      const role = await roleIn(ctx, defect.projectId);
      checkRevision(defect, revision);
      const problem = checkDefectStatusChange(defect, status, role);
      if (problem) fail(problem, problem.startsWith('Only') ? '42501' : 'PF422');
      const next: Defect = { ...defect, status, resolvedAt: status === 'closed' ? ctx.now() : status === 'reopened' ? null : defect.resolvedAt };
      const saved = await save(ctx, 'defects', next, revision);
      await recordEvent(ctx, defect.projectId, 'defect', defectId, 'status', { from: defect.status, to: status, body: comment.trim() });
      return saved;
    },
  ),

  // ----- AI ---------------------------------------------------------------------

  generateStories: op(z.strictObject({ projectId: Id, processId: Id, nodeKeys: Ids.optional() }), async (ctx, { projectId, processId, nodeKeys }): Promise<StoryProposal> => {
    await requirePermission(ctx, projectId, 'editFunctional', 'Only Business Analysts and Administrators can write functional stories');
    const context = await ctx.store.context(projectId);
    const process = context.processes.find((p) => p.id === processId) ?? fail('Process not found.', 'P0002');
    const version = approvedVersion(context, processId) ?? fail(`Approve ${process.name} before writing stories from it, so they are based on agreed requirements.`, 'PF422');
    const fieldsById = new Map(context.fields.map((f) => [f.id, f]));
    const actors = new Map(context.actors.map((a) => [a.id, a.name]));
    const nodes = context.nodes.filter(
      (n) => n.version_id === version.id && n.node_type !== 'start' && n.node_type !== 'end' && n.node_type !== 'decision' && (!nodeKeys || nodeKeys.includes(n.element_key)),
    );
    if (nodes.length === 0) fail('The process has no activities to write stories for.', 'PF422');
    const keyById = new Map(nodes.map((n, i) => [`A${i + 1}`, n.element_key]));
    const uses = context.activityFields.filter((f) => f.version_id === version.id);
    const stories = await ctx.store.list('stories', projectId);
    const input = {
      processName: process.name,
      processDescription: version.description,
      activities: nodes.map((n, i) => ({
        id: `A${i + 1}`,
        refCode: n.ref_code,
        type: n.node_type,
        label: n.label,
        description: n.description,
        actor: n.actor_id ? (actors.get(n.actor_id) ?? null) : null,
        inputs: uses
          .filter((u) => u.node_key === n.element_key && u.direction === 'input' && fieldsById.has(u.field_id))
          .map((u) => ({ ref: fieldsById.get(u.field_id)!.refCode, name: fieldsById.get(u.field_id)!.name, mandatory: u.mandatory, condition: u.mandatory_condition })),
        outputs: uses.filter((u) => u.node_key === n.element_key && u.direction === 'output' && fieldsById.has(u.field_id)).map((u) => fieldsById.get(u.field_id)!.refCode),
      })),
      fields: context.fields.filter((f) => f.status !== 'deprecated').map((f) => ({ ref: f.refCode, name: f.name, dataType: f.dataType })),
      businessRules: context.businessRules.filter((r) => r.status !== 'retired').map((r) => ({ ref: r.refCode, statement: r.statement })),
      existingStories: stories
        .filter((s) => s.storyType === 'functional' && s.activities.some((a) => a.processId === processId))
        .map((s) => ({ ref: s.refCode, title: s.title })),
    };
    const result = await ctx.ai.run(STORY_GENERATION_TASK, input, { projectId, subjectId: version.id }, ctx.signal);
    const fieldByRef = new Map(context.fields.map((f) => [f.refCode, f.id]));
    const ruleByRef = new Map(context.businessRules.map((r) => [r.refCode, r.id]));
    return {
      runId: result.runId,
      model: result.model,
      questions: result.value.questions,
      stories: result.value.stories.map((s) => ({
        storyType: 'functional',
        origin: s.origin,
        assumptions: [],
        content: {
          ...EMPTY_STORY_CONTENT,
          title: s.title,
          userRole: s.userRole,
          objective: s.objective,
          benefit: s.benefit,
          description: s.description,
          behaviour: toItems(ctx, s.behaviour),
          alternativeFlows: toItems(ctx, s.alternativeFlows),
          acceptanceCriteria: toItems(ctx, s.acceptanceCriteria),
          activities: s.activityIds.map((id) => ({ processId, nodeKey: keyById.get(id)! })),
          fieldIds: dedupe(s.fieldRefs.map((r) => fieldByRef.get(r)!)),
          businessRuleIds: dedupe(s.businessRuleRefs.map((r) => ruleByRef.get(r)!)),
        },
      })),
    };
  }),

  generateTechnicalStories: op(z.strictObject({ storyId: Id }), async (ctx, { storyId }): Promise<StoryProposal> => {
    const story = await load(ctx, 'stories', storyId);
    await requirePermission(ctx, story.projectId, 'editTechnical', 'You do not have permission to write technical stories');
    if (story.storyType !== 'functional') fail('Technical stories are generated from a functional story', 'PF422');
    const [context, stories] = await Promise.all([ctx.store.context(story.projectId), ctx.store.list('stories', story.projectId)]);
    const index = activityIndex(context);
    const activityFieldIds = story.activities.flatMap((a) => {
      const info = index.get(activityKey(a));
      return info ? context.activityFields.filter((f) => f.version_id === info.versionId && f.node_key === a.nodeKey).map((f) => f.field_id) : [];
    });
    const fieldIds = new Set([...story.fieldIds, ...activityFieldIds]);
    const fields = context.fields.filter((f) => fieldIds.has(f.id));
    const rules = context.validationRules.filter((r) => fieldIds.has(r.fieldId));
    const fieldRef = new Map(context.fields.map((f) => [f.id, f.refCode]));
    const columnName = new Map(context.columns.map((c) => [c.id, `${c.systemName} ${c.tableName}.${c.columnName} (${c.dataType || 'type not recorded'})`]));
    const input = {
      story: {
        ref: story.refCode,
        title: story.title,
        userRole: story.userRole,
        objective: story.objective,
        description: story.description,
        behaviour: story.behaviour.map((b) => b.text),
        alternativeFlows: story.alternativeFlows.map((b) => b.text),
        acceptanceCriteria: story.acceptanceCriteria.map((b) => b.text),
      },
      fields: fields.map((f) => ({
        ref: f.refCode,
        name: f.name,
        dataType: f.dataType,
        source: f.source,
        mappedColumns: context.columnMappings.filter((m) => m.fieldId === f.id).map((m) => columnName.get(m.columnId) ?? '').filter(Boolean),
      })),
      validationRules: rules.map((r) => ({ ref: r.refCode, fieldRef: fieldRef.get(r.fieldId) ?? '', statement: r.statement })),
      businessRules: context.businessRules.filter((r) => story.businessRuleIds.includes(r.id)).map((r) => ({ ref: r.refCode, statement: r.statement })),
      knownColumns: [...columnName.values()],
      existingTechnicalStories: stories.filter((s) => s.implementsIds.includes(storyId)).map((s) => ({ ref: s.refCode, title: s.title })),
    };
    const result = await ctx.ai.run(TECHNICAL_STORY_TASK, input, { projectId: story.projectId, subjectId: storyId }, ctx.signal);
    const fieldByRef = new Map(context.fields.map((f) => [f.refCode, f.id]));
    const ruleByRef = new Map(context.validationRules.map((r) => [r.refCode, r.id]));
    return {
      runId: result.runId,
      model: result.model,
      questions: result.value.questions,
      stories: result.value.technicalStories.map((t) => ({
        storyType: 'technical',
        origin: 'inferred',
        assumptions: t.assumptions,
        content: {
          ...EMPTY_STORY_CONTENT,
          title: t.title,
          objective: t.objective,
          apiBehaviour: t.apiBehaviour,
          requiredData: t.requiredData,
          validationLogic: t.validationLogic,
          expectedResponse: t.expectedResponse,
          errorScenarios: toItems(ctx, t.errorScenarios),
          acceptanceCriteria: toItems(ctx, t.acceptanceCriteria),
          notes: t.assumptions.length ? `Assumptions to confirm:\n${t.assumptions.map((a) => `- ${a}`).join('\n')}` : '',
          activities: story.activities,
          fieldIds: dedupe(t.fieldRefs.map((r) => fieldByRef.get(r)!)),
          validationRuleIds: dedupe(t.validationRuleRefs.map((r) => ruleByRef.get(r)!)),
          businessRuleIds: story.businessRuleIds,
          implementsIds: [storyId],
        },
      })),
    };
  }),

  generateScenarios: op(z.strictObject({ projectId: Id, storyIds: Ids.min(1) }), async (ctx, { projectId, storyIds }): Promise<ScenarioProposal> => {
    await requirePermission(ctx, projectId, 'editScenarios', 'Only Business Analysts and Administrators can write test scenarios');
    const [context, stories, scenarios] = await Promise.all([ctx.store.context(projectId), ctx.store.list('stories', projectId), ctx.store.list('scenarios', projectId)]);
    const functional = stories.filter((s) => storyIds.includes(s.id) && s.storyType === 'functional');
    if (functional.length === 0) fail('Choose at least one functional story', 'PF422');
    const fIds = new Set(functional.map((s) => s.id));
    const technical = stories.filter((s) => s.storyType === 'technical' && (storyIds.includes(s.id) || s.implementsIds.some((id) => fIds.has(id))));
    const refById = new Map(stories.map((s) => [s.id, s.refCode]));
    const processIds = dedupe(functional.flatMap((s) => s.activities.map((a) => a.processId)));
    const process = context.processes.find((p) => p.id === processIds[0]);
    const input = {
      processName: process?.name ?? '',
      stories: [...functional, ...technical].map((s) => ({
        ref: s.refCode,
        type: s.storyType,
        title: s.title,
        behaviour: s.behaviour.map((b) => b.text),
        alternativeFlows: s.alternativeFlows.map((b) => b.text),
        acceptanceCriteria: s.acceptanceCriteria.map((b) => b.text),
        implements: s.implementsIds.map((id) => refById.get(id) ?? ''),
      })),
      businessRules: context.businessRules.filter((r) => functional.some((s) => s.businessRuleIds.includes(r.id))).map((r) => ({ ref: r.refCode, statement: r.statement })),
      fields: context.fields.filter((f) => functional.some((s) => s.fieldIds.includes(f.id))).map((f) => ({ ref: f.refCode, name: f.name, dataType: f.dataType })),
      existingScenarios: scenarios.filter((sc) => sc.storyIds.some((id) => technical.some((t) => t.id === id))).map((sc) => ({ ref: sc.refCode, title: sc.title })),
    };
    const result = await ctx.ai.run(SCENARIO_GENERATION_TASK, input, { projectId, subjectId: functional[0]!.id }, ctx.signal);
    const idByRef = new Map(stories.map((s) => [s.refCode, s.id]));
    const activities = [...new Map(functional.flatMap((s) => s.activities).map((a) => [activityKey(a), a])).values()];
    return {
      runId: result.runId,
      model: result.model,
      questions: result.value.questions,
      scenarios: result.value.scenarios.map((sc) => ({
        title: sc.title,
        scenarioType: sc.scenarioType,
        description: sc.description,
        processId: process?.id ?? null,
        activities,
        preconditions: toItems(ctx, sc.preconditions),
        steps: sc.steps.map((st) => ({ id: ctx.newId(), ...st })),
        storyIds: dedupe(sc.storyRefs.map((r) => idByRef.get(r)!)),
        prerequisites: sc.prerequisites,
      })),
    };
  }),

  refineStory: op(z.strictObject({ storyId: Id }), async (ctx, { storyId }): Promise<RefinementProposal> => {
    const story = await load(ctx, 'stories', storyId);
    const role = await roleIn(ctx, story.projectId);
    if (!canEditStory(role, story) && !canDeliver(role, 'reviewStory')) fail('You do not have permission to refine this story', '42501');
    const context = await ctx.store.context(story.projectId);
    const index = activityIndex(context);
    const input = {
      story: {
        ref: story.refCode,
        type: story.storyType,
        title: story.title,
        userRole: story.userRole,
        objective: story.objective,
        benefit: story.benefit,
        description: story.description,
        behaviour: story.behaviour.map((b) => b.text),
        alternativeFlows: story.alternativeFlows.map((b) => b.text),
        acceptanceCriteria: story.acceptanceCriteria.map((b) => b.text),
      },
      activities: story.activities.map((a) => index.get(activityKey(a))?.label ?? '').filter(Boolean),
      fields: context.fields.filter((f) => story.fieldIds.includes(f.id)).map((f) => ({ ref: f.refCode, name: f.name })),
      businessRules: context.businessRules.filter((r) => story.businessRuleIds.includes(r.id)).map((r) => ({ ref: r.refCode, statement: r.statement })),
    };
    const result = await ctx.ai.run(REFINEMENT_TASK, input, { projectId: story.projectId, subjectId: storyId }, ctx.signal);
    return { runId: result.runId, model: result.model, refinement: result.value };
  }),

  analyseChangeImpact: op(z.strictObject({ processId: Id, fromVersionId: Id.optional(), toVersionId: Id.optional(), useAi: z.boolean().default(true) }), async (ctx, input): Promise<ChangeImpactResult> => {
    const projects = await findProcessProject(ctx, input.processId);
    await requirePermission(ctx, projects.projectId, 'runInsights', 'Only Business Analysts, Product Owners and Administrators can analyse change impact');
    const { context } = projects;
    const process = context.processes.find((p) => p.id === input.processId)!;
    const versions = context.versions.filter((v) => v.process_id === input.processId).sort((a, b) => b.version_number - a.version_number);
    const to = input.toVersionId ? versions.find((v) => v.id === input.toVersionId) : currentVersion(context, input.processId);
    const from = input.fromVersionId
      ? versions.find((v) => v.id === input.fromVersionId)
      : versions.find((v) => to && v.version_number < to.version_number && v.status !== 'draft');
    if (!to || !from) {
      return { fromVersion: from ? { id: from.id, versionNumber: from.version_number } : null, toVersion: to ? { id: to.id, versionNumber: to.version_number } : null, impact: { changes: [], affectedActivities: [], affectedFieldIds: [], items: [] }, assessment: null, runId: null, model: null };
    }
    const snapshot = await loadSnapshot(ctx, projects.projectId);
    const impact = analyseChangeImpact(context, snapshot, input.processId, from.id, to.id);
    let assessment: ChangeImpactAssessment | null = null;
    let runId: string | null = null;
    let model: string | null = null;
    if (input.useAi && impact.items.length > 0) {
      const result = await ctx.ai.run(
        CHANGE_IMPACT_TASK,
        { processName: process.name, changes: impact.changes.map((c) => c.description), items: impact.items.map((i) => ({ ref: i.refCode, type: i.type, title: i.title, status: i.status, reasons: i.reasons })) },
        { projectId: projects.projectId, subjectId: to.id },
        ctx.signal,
      );
      assessment = result.value;
      runId = result.runId;
      model = result.model;
    }
    return { fromVersion: { id: from.id, versionNumber: from.version_number }, toVersion: { id: to.id, versionNumber: to.version_number }, impact, assessment, runId, model };
  }),

  applyChangeImpact: op(
    z.strictObject({
      projectId: Id,
      processId: Id,
      summary: LongText,
      items: z.array(z.strictObject({ id: Id, type: z.enum(['functional_story', 'technical_story', 'scenario']), refCode: ShortText, reason: z.string().max(2000), impact: z.enum(['high', 'medium', 'low']) })).min(1).max(200),
    }),
    async (ctx, { projectId, processId, summary, items }) => {
      await requirePermission(ctx, projectId, 'runInsights', 'Only Business Analysts, Product Owners and Administrators can apply change impact');
      // Flags the items for review. Approved content itself is never changed here.
      for (const item of items) {
        if (item.type === 'scenario') {
          const sc = await load(ctx, 'scenarios', item.id);
          if (sc.projectId !== projectId) fail('An item is not in this project', 'PF422');
          await save(ctx, 'scenarios', { ...sc, reviewFlag: item.reason }, sc.revision);
          await recordEvent(ctx, projectId, 'scenario', sc.id, 'flag', { to: 'review required', body: item.reason });
        } else {
          const story = await load(ctx, 'stories', item.id);
          if (story.projectId !== projectId) fail('An item is not in this project', 'PF422');
          await save(ctx, 'stories', { ...story, reviewFlag: item.reason }, story.revision);
          await recordEvent(ctx, projectId, 'story', story.id, 'flag', { to: 'review required', body: item.reason });
        }
      }
      const highest = items.some((i) => i.impact === 'high') ? 'high' : items.some((i) => i.impact === 'medium') ? 'medium' : 'low';
      const insight: Insight = {
        id: ctx.newId(),
        projectId,
        kind: 'change_impact',
        title: `Process change affects ${items.length} item${items.length === 1 ? '' : 's'}`,
        detail: [summary.trim(), ...items.map((i) => `${i.refCode}: ${i.reason}`)].filter(Boolean).join('\n'),
        subjects: items.map((i) => i.refCode),
        impact: highest,
        processId,
        status: 'accepted',
        createdBy: ctx.userId,
        createdAt: ctx.now(),
        decidedBy: ctx.userId,
        decidedAt: ctx.now(),
      };
      await ctx.store.insert('insights', insight);
      return insight;
    },
  ),

  suggestImprovements: op(z.strictObject({ processId: Id }), async (ctx, { processId }) => {
    const { projectId, context } = await findProcessProject(ctx, processId);
    await requirePermission(ctx, projectId, 'runInsights', 'Only Business Analysts, Product Owners and Administrators can request recommendations');
    const process = context.processes.find((p) => p.id === processId)!;
    const version = currentVersion(context, processId) ?? fail('The process has no map yet.', 'PF422');
    const snapshot = await loadSnapshot(ctx, projectId);
    const nodes = context.nodes.filter((n) => n.version_id === version.id && n.node_type !== 'start' && n.node_type !== 'end');
    const idByKey = new Map(nodes.map((n, i) => [n.element_key, `A${i + 1}`]));
    const actors = new Map(context.actors.map((a) => [a.id, a.name]));
    const edges = context.edges.filter((e) => e.version_id === version.id);
    const storiesFor = (key: string) => snapshot.stories.filter((s) => s.activities.some((a) => a.processId === processId && a.nodeKey === key)).map((s) => s.id);
    const input = {
      processName: process.name,
      processDescription: version.description,
      activities: nodes.map((n) => {
        const storyIds = new Set(storiesFor(n.element_key));
        const scenarioIds = new Set(snapshot.scenarios.filter((sc) => sc.activities.some((a) => a.nodeKey === n.element_key)).map((sc) => sc.id));
        return {
          id: idByKey.get(n.element_key)!,
          refCode: n.ref_code,
          type: n.node_type,
          label: n.label,
          actor: n.actor_id ? (actors.get(n.actor_id) ?? null) : null,
          next: edges.filter((e) => e.source_key === n.element_key).map((e) => idByKey.get(e.target_key) ?? 'end'),
          inputCount: context.activityFields.filter((f) => f.version_id === version.id && f.node_key === n.element_key && f.direction === 'input').length,
          defects: snapshot.defects.filter((d) => d.storyIds.some((id) => storyIds.has(id)) || (d.scenarioId && scenarioIds.has(d.scenarioId))).length,
          failedTests: snapshot.executions.filter((e) => scenarioIds.has(e.scenarioId) && e.status === 'failed').length,
        };
      }),
    };
    const result = await ctx.ai.run(IMPROVEMENT_TASK, input, { projectId, subjectId: version.id }, ctx.signal);
    const refById = new Map(nodes.map((n) => [idByKey.get(n.element_key)!, n.ref_code ?? n.label]));
    const created: Insight[] = [];
    for (const r of result.value.recommendations) {
      const insight: Insight = {
        id: ctx.newId(),
        projectId,
        kind: 'improvement',
        title: r.title,
        detail: r.detail,
        subjects: r.activityIds.map((id) => refById.get(id) ?? id),
        impact: r.impact,
        processId,
        status: 'open',
        createdBy: ctx.userId,
        createdAt: ctx.now(),
        decidedBy: null,
        decidedAt: null,
      };
      await ctx.store.insert('insights', insight);
      created.push(insight);
    }
    return { runId: result.runId, model: result.model, insights: created };
  }),

  decideInsight: op(z.strictObject({ insightId: Id, status: z.enum(['accepted', 'dismissed', 'open']) }), async (ctx, { insightId, status }) => {
    const insight = await load(ctx, 'insights', insightId);
    await requirePermission(ctx, insight.projectId, 'runInsights', 'Only Business Analysts, Product Owners and Administrators can decide on recommendations');
    const next: Insight = { ...insight, status, decidedBy: status === 'open' ? null : ctx.userId, decidedAt: status === 'open' ? null : ctx.now() };
    await ctx.store.update('insights', next);
    return next;
  }),
};

async function findProcessProject(ctx: OpContext, processId: string): Promise<{ projectId: string; context: ProjectContext }> {
  const projectId = (await ctx.store.processProject(processId)) ?? fail('Process not found.', 'P0002');
  const context = await ctx.store.context(projectId);
  if (!context.processes.some((p) => p.id === processId)) fail('Process not found.', 'P0002');
  return { projectId, context };
}

export type DeliveryOps = typeof DELIVERY_OPS;
export type DeliveryOpName = keyof DeliveryOps;
export type DeliveryOpInput<K extends DeliveryOpName> = z.input<DeliveryOps[K]['input']>;
export type DeliveryOpResult<K extends DeliveryOpName> = Awaited<ReturnType<DeliveryOps[K]['run']>>;

/** A client for the delivery operations, as the web app sees them. */
export type DeliveryClient = { [K in DeliveryOpName]: (input: DeliveryOpInput<K>, signal?: AbortSignal) => Promise<DeliveryOpResult<K>> };

/** Validates an operation's input and runs it. Unknown operations and invalid input are rejected. */
export async function runDeliveryOp(ctx: OpContext, name: string, input: unknown): Promise<unknown> {
  if (!Object.hasOwn(DELIVERY_OPS, name)) throw new DomainError(`Unknown operation "${name}"`, 'invalid_request');
  const operation = DELIVERY_OPS[name as DeliveryOpName] as Op<z.ZodType, unknown>;
  const parsed = operation.input.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DomainError(issue ? `${issue.path.join('.') || 'input'}: ${issue.message}` : 'Invalid request.', 'invalid_request');
  }
  return operation.run(ctx, parsed.data);
}
