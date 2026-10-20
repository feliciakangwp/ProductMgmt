import {
  createMemoryDeliveryStore,
  DomainError,
  runDeliveryOp,
  type AiGateway,
  type DeliveryClient,
  type DeliveryOpInput,
  type DeliveryOpName,
  type DeliveryOpResult,
  type DeliveryTables,
  type OpContext,
  type ProjectContext,
  type ProjectRole,
  type Story,
} from '@productflow/domain';
import { fixtureAiGateway } from '@productflow/domain/testing';
import { AppError } from '../errors';
import { runStructured } from './demo-ai';

/**
 * Delivery (Phases 3 to 7) in the demo: the same delivery service the API
 * runs, over the demo's browser storage. A failed operation leaves the data
 * as it was.
 */

export interface DemoDeliveryHost {
  userId: string;
  tables(): DeliveryTables;
  replaceTables(tables: DeliveryTables): void;
  context(projectId: string): ProjectContext;
  memberRole(projectId: string, userId: string): ProjectRole | null;
  nextRef(projectId: string, prefix: string): string;
  processProject(processId: string): string | null;
  commit(): void;
}

const browserAi: AiGateway = {
  async run(task, input, _meta, signal) {
    const { value, model } = await runStructured({
      system: task.system,
      user: task.user(input),
      schema: task.schema(),
      parse: (raw) => task.parse(raw, input),
      signal,
    });
    return { value, model, runId: globalThis.crypto.randomUUID() };
  },
};

export function createDemoDelivery(host: DemoDeliveryHost) {
  const store = createMemoryDeliveryStore(host);
  const context = (userId: string, ai: AiGateway, now: () => string, signal?: AbortSignal): OpContext => ({
    store,
    userId,
    ai,
    now,
    newId: () => globalThis.crypto.randomUUID(),
    signal,
  });

  async function run(op: string, input: unknown, signal?: AbortSignal) {
    const before = structuredClone(host.tables());
    try {
      const result = await runDeliveryOp(context(host.userId, browserAi, () => new Date().toISOString(), signal), op, input);
      host.commit();
      return result === undefined ? null : structuredClone(result);
    } catch (err) {
      host.replaceTables(before);
      if (err instanceof DomainError) throw new AppError(err.message, err.code);
      throw err;
    }
  }

  const client = new Proxy({} as DeliveryClient, {
    get: (_target, op: string) => (input: unknown, signal?: AbortSignal) => run(op, input, signal),
  });

  return { client, seed: (projectId: string, processId: string, users: SeedUsers) => seedDelivery(store, context, projectId, processId, users) };
}

interface SeedUsers {
  admin: string;
  productOwner: string;
  developer: string;
}

const DAY = 24 * 3600 * 1000;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Example delivery history for the debt write-off process, written through
 * the real operations on a simulated clock: a completed sprint, an active
 * sprint with work in progress, a failed UAT run and the defect it raised.
 */
async function seedDelivery(
  store: ReturnType<typeof createMemoryDeliveryStore>,
  context: (userId: string, ai: AiGateway, now: () => string) => OpContext,
  projectId: string,
  processId: string,
  users: SeedUsers,
) {
  const today = Date.parse(`${isoDate(Date.now())}T09:00:00Z`);
  let clock = today - 24 * DAY;
  const ai = fixtureAiGateway();
  const as = (userId: string) => <K extends DeliveryOpName>(op: K, input: DeliveryOpInput<K>) =>
    runDeliveryOp(context(userId, ai, () => new Date(clock).toISOString()), op, input) as Promise<DeliveryOpResult<K>>;
  const admin = as(users.admin);
  const po = as(users.productOwner);
  const dev = as(users.developer);
  const at = (day: number, hour = 10) => (clock = today + day * DAY + (hour - 9) * 3600 * 1000);

  const advance = async (story: Story, to: Story['workStatus'][]) => {
    let s = story;
    for (const status of to) s = await dev('moveStory', { storyId: s.id, revision: s.revision, to: status });
    return s;
  };
  const toBacklog = async (story: Story) => {
    let s = await admin('setStoryStatus', { storyId: story.id, revision: story.revision, status: 'pending_review' });
    s = await po('setStoryStatus', { storyId: s.id, revision: s.revision, status: 'approved' });
    return po('setStoryStatus', { storyId: s.id, revision: s.revision, status: 'in_backlog' });
  };
  const plan = async (story: Story, priority: Story['priority'], value: number, points: number, hours: number) => {
    let s = await po('updateBacklog', { storyId: story.id, revision: story.revision, patch: { priority, businessValue: value } });
    s = await dev('updateBacklog', { storyId: s.id, revision: s.revision, patch: { storyPoints: points, estimateHours: hours, assigneeId: users.developer } });
    return s;
  };

  // Functional stories from the approved process, through review into the backlog.
  at(-24);
  const proposal = await admin('generateStories', { projectId, processId });
  const functional = await admin('createStories', {
    projectId,
    stories: proposal.stories.map((s) => ({ storyType: s.storyType, content: s.content, origin: s.origin })),
  });
  at(-23);
  const backlog: Story[] = [];
  for (const [i, story] of functional.entries()) {
    if (i >= 4) break; // the rest stay as drafts for the analyst
    backlog.push(await toBacklog(story));
  }

  // Technical stories for the first two functional stories, designs confirmed by the developer.
  const technical: Story[] = [];
  for (const parent of backlog.slice(0, 2)) {
    const tech = await dev('generateTechnicalStories', { storyId: parent.id });
    const created = await dev('createStories', {
      projectId,
      stories: tech.stories.map((t) => ({ storyType: t.storyType, content: t.content, origin: t.origin })),
    });
    for (const t of created) {
      const confirmed = await dev('updateStory', { storyId: t.id, revision: t.revision, content: {}, designStatus: 'confirmed' });
      technical.push(await toBacklog(confirmed));
    }
  }
  const sizes: [Story['priority'], number, number, number][] = [
    ['critical', 9, 5, 16],
    ['high', 8, 3, 10],
    ['high', 7, 5, 14],
    ['medium', 6, 3, 8],
  ];
  for (let i = 0; i < technical.length; i++) technical[i] = await plan(technical[i]!, ...sizes[i % sizes.length]!);
  for (let i = 0; i < backlog.length; i++) backlog[i] = await plan(backlog[i]!, ...sizes[(i + 1) % sizes.length]!);

  // Sprint 1: two weeks, three of four committed stories completed.
  at(-21, 9);
  const s1 = await po('createSprint', {
    projectId,
    name: 'Sprint 1',
    objective: 'Write-off request capture and validation',
    startDate: isoDate(clock),
    endDate: isoDate(clock + 11 * DAY),
    capacityHours: 60,
    team: 'Debt Management',
  });
  const sprint1 = [technical[0]!, technical[1]!, technical[2]!, backlog[2]!];
  for (const s of sprint1) await po('addToSprint', { sprintId: s1.id, storyId: s.id });
  let sprintOne = await po('setSprintStatus', { sprintId: s1.id, revision: s1.revision, status: 'active' });
  const reload = async (id: string) => (await store.get('stories', id))!;
  const work = async (id: string, startDay: number, endDay: number, remainingMid: number, actual: number) => {
    at(startDay);
    let s = await advance(await reload(id), ['in_planning', 'in_development']);
    at(Math.round((startDay + endDay) / 2));
    s = await dev('updateEffort', { storyId: s.id, revision: s.revision, remainingHours: remainingMid, actualHours: Math.round(actual / 2) });
    at(endDay);
    s = await dev('updateEffort', { storyId: s.id, revision: s.revision, actualHours: actual });
    return advance(s, ['ready_for_testing', 'in_testing', 'completed']);
  };
  await work(technical[0]!.id, -20, -17, 8, 18);
  await work(technical[1]!.id, -18, -14, 4, 9);
  await work(technical[2]!.id, -16, -11, 6, 15);
  at(-15);
  const unfinished = await advance(await reload(backlog[2]!.id), ['in_planning', 'in_development']);
  at(-13);
  await dev('updateEffort', { storyId: unfinished.id, revision: unfinished.revision, remainingHours: 5, actualHours: 4 });
  at(-10, 17);
  sprintOne = await po('setSprintStatus', { sprintId: s1.id, revision: sprintOne.revision, status: 'completed' });

  // Sprint 2: active now.
  at(-7, 9);
  const s2 = await po('createSprint', {
    projectId,
    name: 'Sprint 2',
    objective: 'Supervisor review and status update',
    startDate: isoDate(clock),
    endDate: isoDate(clock + 13 * DAY),
    capacityHours: 50,
    team: 'Debt Management',
  });
  for (const s of [backlog[2]!, technical[3] ?? backlog[3]!, backlog[0]!]) await po('addToSprint', { sprintId: s2.id, storyId: s.id });
  await po('setSprintStatus', { sprintId: s2.id, revision: s2.revision, status: 'active' });
  at(-6);
  if (technical[3]) await work(technical[3].id, -6, -3, 4, 9);
  at(-2);
  let blocked = await reload(backlog[0]!.id);
  blocked = await advance(blocked, ['in_planning', 'in_development']);
  await dev('setBlocked', { storyId: blocked.id, revision: blocked.revision, blocked: true, reason: 'Waiting for read access to the debt ledger API' });

  // UAT: scenarios for the first functional story, a failed run and its defect.
  at(-3);
  const scenarios = await admin('generateScenarios', { projectId, storyIds: [backlog[0]!.id] });
  const created = await admin('createScenarios', {
    projectId,
    scenarios: scenarios.scenarios.map((content) => ({ content: { ...content, storyIds: [technical[0]!.id, technical[1]!.id] }, origin: 'inferred' as const })),
  });
  const main = await po('setScenarioStatus', { scenarioId: created[0]!.id, revision: created[0]!.revision, status: 'approved' });
  const ready = await admin('setPrerequisites', { scenarioId: main.id, revision: main.revision, prerequisites: main.prerequisites, met: true });
  at(-2, 14);
  let run = await admin('startExecution', { scenarioId: ready.id });
  for (const [i, step] of run.steps.entries()) {
    const failed = i === run.steps.length - 1;
    run = await admin('recordStepResult', {
      executionId: run.id,
      revision: run.revision,
      stepId: step.id,
      status: failed ? 'fail' : 'pass',
      testData: step.inputData,
      actualResult: failed ? 'The request was saved but the debt status still shows Open.' : 'As expected',
      remarks: failed ? 'Reproduced twice with TR-1001.' : '',
    });
  }
  run = await admin('completeExecution', { executionId: run.id, revision: run.revision, remarks: 'Last step failed' });
  const failedStep = run.steps[run.steps.length - 1]!;
  let defect = await admin('createDefect', {
    projectId,
    title: 'Debt status not updated after submission',
    severity: 'major',
    priority: 'high',
    executionId: run.id,
    stepId: failedStep.id,
    sprintId: s2.id,
  });
  at(-1);
  defect = await dev('updateDefect', { defectId: defect.id, revision: defect.revision, patch: { assigneeId: users.developer } });
  await dev('setDefectStatus', { defectId: defect.id, revision: defect.revision, status: 'in_progress', comment: 'Status update job is not triggered after save.' });
}
