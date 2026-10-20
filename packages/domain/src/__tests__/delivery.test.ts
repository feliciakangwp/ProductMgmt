import { describe, expect, it } from 'vitest';
import {
  analyseChangeImpact,
  consistencyChecks,
  DELIVERY_OPS,
  DomainError,
  flowMetrics,
  runDeliveryOp,
  scenarioReadiness,
  sprintBurndown,
  sprintCapacity,
  sprintVelocity,
  STORY_GENERATION_TASK,
  traceActivity,
  uatSummary,
  type DeliveryOpInput,
  type DeliveryOpName,
  type Story,
} from '../index';
import { createDeliveryHarness, USERS } from '../testing/fixtures';

type Harness = ReturnType<typeof createDeliveryHarness>;

function client(h: Harness, userId: string) {
  return <K extends DeliveryOpName>(name: K, input: DeliveryOpInput<K>) =>
    runDeliveryOp(h.ctx(userId), name, input) as Promise<Awaited<ReturnType<(typeof DELIVERY_OPS)[K]['run']>>>;
}

async function rejects(promise: Promise<unknown>, code: string, message?: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  if (message) expect((error as DomainError).message).toMatch(message);
}

const criteria = (...texts: string[]) => texts.map((text, i) => ({ id: `ac-${i}`, text }));

/** Creates, reviews and approves a functional story for the submit activity, then adds it to the backlog. */
async function backlogStory(h: Harness, title = 'Submit a write-off request', extra: Partial<Story> = {}) {
  const ba = client(h, USERS.ba);
  const po = client(h, USERS.po);
  let story = await ba('createStory', {
    projectId: h.projectId,
    storyType: 'functional',
    content: {
      title,
      userRole: 'Finance Officer',
      objective: 'to submit a write-off request',
      acceptanceCriteria: criteria('Given a debt older than five years, when submitted, then it goes to review.'),
      activities: [{ processId: h.processId, nodeKey: 'k-submit' }],
      fieldIds: ['f-debt', 'f-amount'],
      ...(extra as object),
    },
  });
  story = await ba('setStoryStatus', { storyId: story.id, revision: story.revision, status: 'pending_review' });
  story = await po('setStoryStatus', { storyId: story.id, revision: story.revision, status: 'approved' });
  return po('setStoryStatus', { storyId: story.id, revision: story.revision, status: 'in_backlog' });
}

/** A confirmed technical story implementing `functionalId`, added to the backlog. */
async function backlogTechStory(h: Harness, functionalId: string, title = 'API: submit request') {
  const dev = client(h, USERS.dev);
  const po = client(h, USERS.po);
  let t = await dev('createStory', {
    projectId: h.projectId,
    storyType: 'technical',
    content: { title, acceptanceCriteria: criteria('POST returns 201 with the request id.'), implementsIds: [functionalId] },
  });
  t = await dev('setStoryStatus', { storyId: t.id, revision: t.revision, status: 'pending_review' });
  t = await po('setStoryStatus', { storyId: t.id, revision: t.revision, status: 'approved' });
  return po('setStoryStatus', { storyId: t.id, revision: t.revision, status: 'in_backlog' });
}

describe('stories', () => {
  it('generates functional stories from approved activities and keeps them as proposals', async () => {
    const h = createDeliveryHarness();
    const proposal = await client(h, USERS.ba)('generateStories', { projectId: h.projectId, processId: h.processId });
    expect(proposal.stories.map((s) => s.content.title)).toEqual([
      'Submit write-off request',
      'Review write-off request',
      'Update debt status',
    ]);
    const submit = proposal.stories[0]!;
    expect(submit.content.activities).toEqual([{ processId: h.processId, nodeKey: 'k-submit' }]);
    expect(submit.content.fieldIds).toEqual(['f-debt', 'f-amount']);
    expect(proposal.stories[1]!.content.businessRuleIds).toEqual(['br-1']);
    expect(h.tables.stories).toHaveLength(0); // nothing saved until accepted

    const created = await client(h, USERS.ba)('createStories', {
      projectId: h.projectId,
      stories: proposal.stories.map((s) => ({ storyType: s.storyType, content: s.content, origin: s.origin })),
    });
    expect(created.map((s) => [s.refCode, s.status])).toEqual([
      ['US-001', 'draft'],
      ['US-002', 'draft'],
      ['US-003', 'draft'],
    ]);
  });

  it('rejects AI output that references unknown activities or fields', () => {
    const input = {
      processName: 'P',
      processDescription: '',
      activities: [
        { id: 'A1', refCode: null, type: 'activity', label: 'Do', description: '', actor: null, inputs: [], outputs: [] },
      ],
      fields: [],
      businessRules: [],
      existingStories: [],
    };
    const story = {
      title: 'T',
      activityIds: ['A9'],
      userRole: '',
      objective: '',
      benefit: '',
      description: '',
      behaviour: [],
      alternativeFlows: [],
      acceptanceCriteria: [],
      fieldRefs: ['FLD-404'],
      businessRuleRefs: [],
      origin: 'stated',
    };
    const result = STORY_GENERATION_TASK.parse(JSON.stringify({ stories: [story], questions: [] }), input);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(' ')).toMatch(/A9.*FLD-404/);
  });

  it('enforces roles, review rules, locking and versioning', async () => {
    const h = createDeliveryHarness();
    const ba = client(h, USERS.ba);
    const po = client(h, USERS.po);
    await rejects(
      client(h, USERS.dev)('createStory', { projectId: h.projectId, storyType: 'functional', content: { title: 'X' } }),
      '42501',
    );
    await rejects(client(h, USERS.outsider)('snapshot', { projectId: h.projectId }), 'P0002');
    await rejects(
      ba('createStory', {
        projectId: h.projectId,
        storyType: 'functional',
        content: { title: 'X', activities: [{ processId: h.processId, nodeKey: 'nope' }] },
      }),
      'PF422',
    );

    let story = await ba('createStory', {
      projectId: h.projectId,
      storyType: 'functional',
      content: { title: 'Submit', objective: 'to submit' },
    });
    await rejects(
      ba('setStoryStatus', { storyId: story.id, revision: 1, status: 'pending_review' }),
      'PF422',
      /acceptance criterion/,
    );
    story = await ba('updateStory', {
      storyId: story.id,
      revision: 1,
      content: { acceptanceCriteria: criteria('Given…, when…, then…', '  ') },
    });
    expect(story.acceptanceCriteria).toHaveLength(1);
    await rejects(ba('updateStory', { storyId: story.id, revision: 1, content: { title: 'Stale' } }), 'PF409');

    story = await ba('setStoryStatus', { storyId: story.id, revision: story.revision, status: 'pending_review' });
    await rejects(ba('setStoryStatus', { storyId: story.id, revision: story.revision, status: 'approved' }), '42501');
    await rejects(po('setStoryStatus', { storyId: story.id, revision: story.revision, status: 'in_backlog' }), 'PF422');
    story = await po('setStoryStatus', { storyId: story.id, revision: story.revision, status: 'approved' });
    await rejects(ba('updateStory', { storyId: story.id, revision: story.revision, content: { title: 'Changed' } }), 'PF423');
    story = await po('setStoryStatus', { storyId: story.id, revision: story.revision, status: 'in_backlog' });

    story = await ba('setStoryStatus', {
      storyId: story.id,
      revision: story.revision,
      status: 'draft',
      comment: 'Policy changed',
    });
    expect(story.version).toBe(2);
    const history = h.tables.events
      .filter((e) => e.entityId === story.id && e.kind === 'status')
      .map((e) => `${e.fromValue}>${e.toValue}`);
    expect(history).toEqual(['draft>pending_review', 'pending_review>approved', 'approved>in_backlog', 'in_backlog>draft']);
  });

  it('keeps AI technical designs proposed until a developer confirms them', async () => {
    const h = createDeliveryHarness();
    const functional = await backlogStory(h);
    const proposal = await client(h, USERS.dev)('generateTechnicalStories', { storyId: functional.id });
    expect(proposal.stories.map((s) => s.content.title)).toEqual([
      'API: Submit a write-off request',
      'Validation: Submit a write-off request',
    ]);
    expect(proposal.stories[0]!.content.validationRuleIds).toEqual(['vr-1']);
    expect(proposal.stories[0]!.content.notes).toMatch(/Assumptions to confirm/);

    const [tech] = await client(h, USERS.dev)('createStories', {
      projectId: h.projectId,
      stories: [{ storyType: 'technical', content: proposal.stories[0]!.content, origin: 'inferred' }],
    });
    expect(tech!.designStatus).toBe('proposed');
    expect(tech!.implementsIds).toEqual([functional.id]);
    await rejects(
      client(h, USERS.dev)('setStoryStatus', { storyId: tech!.id, revision: 1, status: 'pending_review' }),
      'PF422',
      /confirm the proposed technical design/,
    );
    await rejects(
      client(h, USERS.ba)('updateStory', { storyId: tech!.id, revision: 1, content: {}, designStatus: 'confirmed' }),
      '42501',
    );
    const confirmed = await client(h, USERS.dev)('updateStory', {
      storyId: tech!.id,
      revision: 1,
      content: {},
      designStatus: 'confirmed',
    });
    expect(confirmed.designStatus).toBe('confirmed');
    await client(h, USERS.dev)('setStoryStatus', { storyId: tech!.id, revision: confirmed.revision, status: 'pending_review' });
  });

  it('rejects dependency loops', async () => {
    const h = createDeliveryHarness();
    const ba = client(h, USERS.ba);
    const a = await ba('createStory', { projectId: h.projectId, storyType: 'functional', content: { title: 'A' } });
    const b = await ba('createStory', {
      projectId: h.projectId,
      storyType: 'functional',
      content: { title: 'B', dependsOnIds: [a.id] },
    });
    await rejects(
      ba('updateStory', { storyId: a.id, revision: a.revision, content: { dependsOnIds: [b.id] } }),
      'PF422',
      /loop: US-001 → US-002/,
    );
  });
});

describe('backlog, sprints and the Kanban board', () => {
  it('preserves the original estimate and limits planning to the right roles', async () => {
    const h = createDeliveryHarness();
    let story = await backlogStory(h);
    await rejects(
      client(h, USERS.dev)('updateBacklog', { storyId: story.id, revision: story.revision, patch: { priority: 'high' } }),
      '42501',
    );
    story = await client(h, USERS.po)('updateBacklog', {
      storyId: story.id,
      revision: story.revision,
      patch: { priority: 'critical', businessValue: 8 },
    });
    story = await client(h, USERS.dev)('updateBacklog', {
      storyId: story.id,
      revision: story.revision,
      patch: { estimateHours: 16, storyPoints: 5 },
    });
    expect([story.originalEstimateHours, story.estimateHours, story.remainingHours]).toEqual([16, 16, 16]);
    story = await client(h, USERS.dev)('updateBacklog', {
      storyId: story.id,
      revision: story.revision,
      patch: { estimateHours: 24 },
    });
    expect([story.originalEstimateHours, story.estimateHours]).toEqual([16, 24]);
    await rejects(
      client(h, USERS.po)('updateBacklog', {
        storyId: story.id,
        revision: story.revision,
        patch: { assigneeId: USERS.outsider },
      }),
      'PF422',
    );
  });

  it('plans a sprint, warns over capacity, and enforces one active sprint per team', async () => {
    const h = createDeliveryHarness();
    const po = client(h, USERS.po);
    const story = await backlogStory(h);
    const sprint = await po('createSprint', {
      projectId: h.projectId,
      name: 'Sprint 1',
      objective: 'Write-off MVP',
      startDate: '2026-11-02',
      endDate: '2026-11-13',
      capacityHours: 10,
      team: 'Core',
    });
    await rejects(
      client(h, USERS.dev)('createSprint', {
        projectId: h.projectId,
        name: 'S',
        objective: '',
        startDate: '2026-11-02',
        endDate: '2026-11-13',
        capacityHours: 10,
        team: '',
      }),
      '42501',
    );
    const item = await po('addToSprint', { sprintId: sprint.id, storyId: story.id, plannedHours: 16, assigneeId: USERS.dev });
    expect(item.committed).toBe(true);
    await rejects(po('addToSprint', { sprintId: sprint.id, storyId: story.id }), 'PF409');
    const capacity = sprintCapacity(sprint, h.tables.sprintItems);
    expect(capacity).toMatchObject({ allocatedHours: 16, remainingHours: -6, utilisation: 160, overCapacity: true });
    expect(h.tables.stories[0]!.status).toBe('in_backlog'); // the backlog record stays

    const second = await po('createSprint', {
      projectId: h.projectId,
      name: 'Sprint 2',
      objective: '',
      startDate: '2026-11-16',
      endDate: '2026-11-27',
      capacityHours: 40,
      team: 'core',
    });
    await po('setSprintStatus', { sprintId: sprint.id, revision: 1, status: 'active' });
    await rejects(po('setSprintStatus', { sprintId: second.id, revision: 1, status: 'active' }), 'PF422', /already active/);
    const settings = await client(h, USERS.admin)('updateSettings', {
      projectId: h.projectId,
      revision: 0,
      patch: { allowConcurrentSprints: true },
    });
    expect(settings.allowConcurrentSprints).toBe(true);
    await po('setSprintStatus', { sprintId: second.id, revision: 1, status: 'active' });
  });

  it('moves cards through the six columns following the workflow rules and records history', async () => {
    const h = createDeliveryHarness();
    const po = client(h, USERS.po);
    const dev = client(h, USERS.dev);
    let story = await backlogStory(h);
    await rejects(
      dev('moveStory', { storyId: story.id, revision: story.revision, to: 'in_development' }),
      'PF422',
      /one column at a time/,
    );
    story = await dev('moveStory', { storyId: story.id, revision: story.revision, to: 'in_planning' });
    await rejects(
      dev('moveStory', { storyId: story.id, revision: story.revision, to: 'in_development' }),
      'PF422',
      /active sprint/,
    );
    const sprint = await po('createSprint', {
      projectId: h.projectId,
      name: 'Sprint 1',
      objective: '',
      startDate: '2026-11-02',
      endDate: '2026-11-13',
      capacityHours: 40,
      team: '',
    });
    await po('addToSprint', { sprintId: sprint.id, storyId: story.id, plannedHours: 8 });
    await po('setSprintStatus', { sprintId: sprint.id, revision: 1, status: 'active' });
    await rejects(
      dev('moveStory', { storyId: story.id, revision: story.revision, to: 'in_development' }),
      'PF422',
      /Assign .* and estimate/,
    );
    story = await dev('updateBacklog', {
      storyId: story.id,
      revision: story.revision,
      patch: { assigneeId: USERS.dev, estimateHours: 8, storyPoints: 3 },
    });
    await rejects(
      client(h, USERS.bu)('moveStory', { storyId: story.id, revision: story.revision, to: 'in_development' }),
      '42501',
    );
    story = await dev('setBlocked', {
      storyId: story.id,
      revision: story.revision,
      blocked: true,
      reason: 'Waiting for API access',
    });
    await rejects(dev('moveStory', { storyId: story.id, revision: story.revision, to: 'in_development' }), 'PF422', /blocked/);
    story = await dev('setBlocked', { storyId: story.id, revision: story.revision, blocked: false });

    for (const to of ['in_development', 'ready_for_testing', 'in_testing', 'completed'] as const) {
      h.advance(24);
      story = await dev('moveStory', { storyId: story.id, revision: story.revision, to });
    }
    expect(story.startedAt).not.toBeNull();
    expect(story.completedAt).not.toBeNull();
    expect(story.remainingHours).toBe(0);
    const moves = h.tables.events.filter((e) => e.entityId === story.id && e.kind === 'work_status');
    expect(moves.map((e) => e.toValue)).toEqual([
      'in_planning',
      'in_development',
      'ready_for_testing',
      'in_testing',
      'completed',
    ]);
    expect(moves.every((e) => e.actorId === USERS.dev && e.createdAt)).toBe(true);
    // Moving back is allowed and clears the completion date.
    story = await dev('moveStory', { storyId: story.id, revision: story.revision, to: 'in_testing' });
    expect(story.completedAt).toBeNull();
  });

  it('counts only committed work completed within the sprint toward velocity', async () => {
    const h = createDeliveryHarness('2026-11-02T08:00:00.000Z');
    const po = client(h, USERS.po);
    const dev = client(h, USERS.dev);
    const sprint = await po('createSprint', {
      projectId: h.projectId,
      name: 'Sprint 1',
      objective: '',
      startDate: '2026-11-02',
      endDate: '2026-11-06',
      capacityHours: 40,
      team: '',
    });
    const ready = async (title: string, points: number, hours: number) => {
      const s = await backlogStory(h, title);
      return dev('updateBacklog', {
        storyId: s.id,
        revision: s.revision,
        patch: { assigneeId: USERS.dev, estimateHours: hours, storyPoints: points },
      });
    };
    const a = await ready('Committed and done', 5, 10);
    const b = await ready('Committed, not done', 3, 6);
    await po('addToSprint', { sprintId: sprint.id, storyId: a.id });
    await po('addToSprint', { sprintId: sprint.id, storyId: b.id });
    let started = await po('setSprintStatus', { sprintId: sprint.id, revision: 1, status: 'active' });
    const c = await ready('Added mid-sprint', 2, 4);
    const added = await po('addToSprint', { sprintId: sprint.id, storyId: c.id });
    expect(added.committed).toBe(false);

    const finish = async (story: Story) => {
      let s = story;
      for (const to of ['in_planning', 'in_development', 'ready_for_testing', 'in_testing', 'completed'] as const) {
        s = await dev('moveStory', { storyId: s.id, revision: s.revision, to });
      }
      return s;
    };
    h.advance(24);
    let a2 = await dev('moveStory', { storyId: a.id, revision: a.revision, to: 'in_planning' });
    a2 = await dev('moveStory', { storyId: a2.id, revision: a2.revision, to: 'in_development' });
    h.advance(24);
    await dev('updateEffort', { storyId: a2.id, revision: a2.revision, remainingHours: 4, actualHours: 6 });
    const aRow = h.tables.stories.find((s) => s.id === a.id)!;
    let aDone = aRow;
    for (const to of ['ready_for_testing', 'in_testing', 'completed'] as const)
      aDone = await dev('moveStory', { storyId: aDone.id, revision: aDone.revision, to });
    await finish(h.tables.stories.find((s) => s.id === c.id)!);
    started = await po('setSprintStatus', { sprintId: sprint.id, revision: started.revision, status: 'completed' });
    h.advance(72);
    // Completed later, in the next sprint: it does not count toward Sprint 1.
    const next = await po('createSprint', {
      projectId: h.projectId,
      name: 'Sprint 2',
      objective: '',
      startDate: '2026-11-09',
      endDate: '2026-11-13',
      capacityHours: 40,
      team: '',
    });
    await po('addToSprint', { sprintId: next.id, storyId: b.id });
    await po('setSprintStatus', { sprintId: next.id, revision: 1, status: 'active' });
    await finish(h.tables.stories.find((s) => s.id === b.id)!);

    const velocity = sprintVelocity(started, h.tables.sprintItems, h.tables.stories);
    expect(velocity).toMatchObject({
      committedCount: 2,
      committedPoints: 8,
      completedCount: 1,
      completedPoints: 5,
      completedHours: 10,
      addedCompletedCount: 1,
      addedCompletedPoints: 2,
      completionRate: 50,
    });

    const burndown = sprintBurndown(started, h.tables.sprintItems, h.tables.stories, h.tables.events, h.now());
    expect(burndown.map((p) => p.remaining)).toEqual([16, 16, 6, 6, 6]);
    expect(burndown[0]!.ideal).toBe(16);
    expect(burndown[4]!.ideal).toBe(0);
    expect(flowMetrics(h.tables.stories, h.now()).averageCycleDays).not.toBeNull();
  });
});

describe('business scenarios, UAT and defects', () => {
  async function readyScenario(h: Harness) {
    const po = client(h, USERS.po);
    const dev = client(h, USERS.dev);
    const functional = await backlogStory(h, 'Submit a write-off request', {
      behaviour: criteria('Open the debt record.', 'Enter the reason.', 'Submit the request.'),
    });
    let tech = await backlogTechStory(h, functional.id);
    const proposal = await client(h, USERS.ba)('generateScenarios', { projectId: h.projectId, storyIds: [functional.id] });
    expect(proposal.scenarios[0]!.storyIds).toEqual([tech.id]);
    const [scenario] = await client(h, USERS.ba)('createScenarios', {
      projectId: h.projectId,
      scenarios: [{ content: proposal.scenarios[0]!, origin: 'inferred' }],
    });
    let sc = await po('setScenarioStatus', { scenarioId: scenario!.id, revision: 1, status: 'approved' });
    const byId = () => new Map(h.tables.stories.map((s) => [s.id, s]));
    expect(scenarioReadiness(sc, byId()).reasons).toEqual([
      'TS-001 is To-do, not Completed',
      'Prerequisites are not confirmed as met',
    ]);
    await rejects(client(h, USERS.bu)('startExecution', { scenarioId: sc.id }), 'PF422', /not ready for testing/);

    const sprint = await po('createSprint', {
      projectId: h.projectId,
      name: 'Sprint 1',
      objective: '',
      startDate: '2026-11-02',
      endDate: '2026-11-13',
      capacityHours: 40,
      team: '',
    });
    await po('addToSprint', { sprintId: sprint.id, storyId: tech.id, plannedHours: 8, assigneeId: USERS.dev });
    await po('setSprintStatus', { sprintId: sprint.id, revision: 1, status: 'active' });
    tech = h.tables.stories.find((s) => s.id === tech.id)!;
    tech = await dev('updateBacklog', { storyId: tech.id, revision: tech.revision, patch: { estimateHours: 8 } });
    for (const to of ['in_planning', 'in_development', 'ready_for_testing', 'in_testing', 'completed'] as const) {
      tech = await dev('moveStory', { storyId: tech.id, revision: tech.revision, to });
    }
    sc = await client(h, USERS.bu)('setPrerequisites', {
      scenarioId: sc.id,
      revision: sc.revision,
      prerequisites: sc.prerequisites,
      met: true,
    });
    expect(scenarioReadiness(sc, byId()).ready).toBe(true);
    return { sc, tech, functional, sprint };
  }

  it('runs UAT, raises a defect from a failed step, and keeps test history', async () => {
    const h = createDeliveryHarness();
    const bu = client(h, USERS.bu);
    const { sc, tech } = await readyScenario(h);

    let run = await bu('startExecution', { scenarioId: sc.id });
    await rejects(bu('startExecution', { scenarioId: sc.id }), 'PF409');
    const [first, ...rest] = run.steps;
    await rejects(bu('completeExecution', { executionId: run.id, revision: run.revision }), 'PF422', /every step/);
    await rejects(
      bu('recordStepResult', {
        executionId: run.id,
        revision: run.revision,
        stepId: first!.id,
        status: 'fail',
        testData: '',
        actualResult: '',
        remarks: '',
      }),
      'PF422',
    );
    run = await bu('recordStepResult', {
      executionId: run.id,
      revision: run.revision,
      stepId: first!.id,
      status: 'fail',
      testData: 'TR-1001',
      actualResult: 'Error 500 shown',
      remarks: 'Happens every time',
    });
    for (const step of rest) {
      run = await bu('recordStepResult', {
        executionId: run.id,
        revision: run.revision,
        stepId: step.id,
        status: 'pass',
        testData: '',
        actualResult: 'As expected',
        remarks: '',
      });
    }
    run = await bu('completeExecution', { executionId: run.id, revision: run.revision, remarks: 'One failure' });
    expect(run.status).toBe('failed');
    await rejects(
      bu('recordStepResult', {
        executionId: run.id,
        revision: run.revision,
        stepId: first!.id,
        status: 'pass',
        testData: '',
        actualResult: '',
        remarks: '',
      }),
      'PF423',
    );

    await rejects(
      bu('createDefect', { projectId: h.projectId, title: 'X', severity: 'major', executionId: run.id, stepId: rest[0]!.id }),
      'PF422',
      /failed steps/,
    );
    let defect = await bu('createDefect', {
      projectId: h.projectId,
      title: 'Submit fails',
      severity: 'major',
      executionId: run.id,
      stepId: first!.id,
    });
    expect(defect).toMatchObject({
      refCode: 'DEF-001',
      scenarioId: sc.id,
      stepId: first!.id,
      storyIds: [tech.id],
      actualResult: 'Error 500 shown',
      remarks: 'Happens every time',
      expectedResult: first!.expectedResult,
      status: 'open',
    });

    // Defect workflow
    const dev = client(h, USERS.dev);
    await rejects(
      dev('setDefectStatus', { defectId: defect.id, revision: defect.revision, status: 'in_progress' }),
      'PF422',
      /Assign/,
    );
    await rejects(
      bu('updateDefect', { defectId: defect.id, revision: defect.revision, patch: { assigneeId: USERS.dev } }),
      '42501',
    );
    defect = await dev('updateDefect', { defectId: defect.id, revision: defect.revision, patch: { assigneeId: USERS.dev } });
    expect(defect.status).toBe('assigned');
    await rejects(bu('setDefectStatus', { defectId: defect.id, revision: defect.revision, status: 'in_progress' }), '42501');
    defect = await dev('setDefectStatus', { defectId: defect.id, revision: defect.revision, status: 'in_progress' });
    defect = await dev('setDefectStatus', { defectId: defect.id, revision: defect.revision, status: 'ready_for_retest' });
    await rejects(dev('setDefectStatus', { defectId: defect.id, revision: defect.revision, status: 'closed' }), '42501');

    // The scenario stays failed until it is retested, even with the defect fixed.
    const status = () => uatSummary(h.tables.scenarios, h.tables.stories, h.tables.executions).counts;
    expect(status().failed).toBe(1);
    let retest = await bu('startExecution', { scenarioId: sc.id });
    for (const step of retest.steps) {
      retest = await bu('recordStepResult', {
        executionId: retest.id,
        revision: retest.revision,
        stepId: step.id,
        status: 'pass',
        testData: '',
        actualResult: 'As expected',
        remarks: '',
      });
    }
    retest = await bu('completeExecution', { executionId: retest.id, revision: retest.revision });
    defect = await bu('setDefectStatus', { defectId: defect.id, revision: defect.revision, status: 'closed' });
    expect(defect.resolvedAt).not.toBeNull();
    expect(status().passed).toBe(1);
    expect(uatSummary(h.tables.scenarios, h.tables.stories, h.tables.executions).passRate).toBe(100);
    expect(h.tables.executions.map((e) => [e.refCode, e.status])).toEqual([
      ['TE-001', 'failed'],
      ['TE-002', 'passed'],
    ]);
  });

  it('rejects oversized or non-image screenshots', async () => {
    const h = createDeliveryHarness();
    const big = `data:image/png;base64,${'A'.repeat(545 * 1024)}`;
    await rejects(
      client(h, USERS.bu)('createDefect', {
        projectId: h.projectId,
        title: 'X',
        severity: 'minor',
        attachments: [{ id: 'a', name: 'x.png', dataUrl: big }],
      }),
      'PF422',
      /KB or smaller/,
    );
    await rejects(
      client(h, USERS.bu)('createDefect', {
        projectId: h.projectId,
        title: 'X',
        severity: 'minor',
        attachments: [{ id: 'a', name: 'x.svg', dataUrl: 'data:image/svg+xml;base64,AAAA' }],
      }),
      'PF422',
    );
  });
});

describe('traceability and advanced AI', () => {
  it('traces an activity to its fields, rules, stories, tests and defects', async () => {
    const h = createDeliveryHarness();
    const functional = await backlogStory(h);
    await backlogTechStory(h, functional.id);
    const snapshot = await client(h, USERS.bu)('snapshot', { projectId: h.projectId });
    const trace = traceActivity(h.context, snapshot, { processId: h.processId, nodeKey: 'k-submit' })!;
    expect(trace.inputs.map((i) => i.field.refCode)).toEqual(['FLD-001', 'FLD-002']);
    expect(trace.validationRules.map((r) => r.refCode)).toEqual(['VR-001']);
    expect(trace.functionalStories.map((s) => s.refCode)).toEqual(['US-001']);
    expect(trace.technicalStories.map((s) => s.refCode)).toEqual(['TS-001']);
  });

  it('finds coverage gaps and untestable wording', async () => {
    const h = createDeliveryHarness();
    await backlogStory(h, 'Submit', { acceptanceCriteria: criteria('The page responds as appropriate.') });
    const snapshot = await client(h, USERS.ba)('snapshot', { projectId: h.projectId });
    const messages = consistencyChecks(h.context, snapshot).map((i) => i.message);
    expect(messages).toContain('ACT-002 "Review write-off request" in PRC-001 has no user story.');
    expect(messages).toContain('US-001 has no technical story implementing it.');
    expect(messages).toContain('Approved business rule BR-001 "Director approval" is not referenced by any story.');
    expect(messages.some((m) => /vague wording \("appropriate"\)/.test(m))).toBe(true);
  });

  it('analyses change impact and flags affected items without changing approved content', async () => {
    const h = createDeliveryHarness();
    const functional = await backlogStory(h);
    const tech = await backlogTechStory(h, functional.id);
    const v2 = h.addChangedDraft();
    const result = await client(h, USERS.ba)('analyseChangeImpact', { processId: h.processId });
    expect(result.toVersion?.id).toBe(v2);
    expect(result.impact.changes.map((c) => c.description)).toEqual([
      'ACT-001 "Lodge write-off request": renamed from "Submit write-off request"',
      'FLD-002 Outstanding Amount removed from ACT-001 "Submit write-off request"',
      'VR-001 validates FLD-002 Outstanding Amount, whose use changed',
    ]);
    expect(result.impact.items.map((i) => i.refCode)).toEqual(['US-001', 'TS-001']);
    expect(result.assessment?.assessments.map((a) => a.impact)).toEqual(['high', 'medium']);

    const before = h.tables.stories.find((s) => s.id === functional.id)!;
    await client(h, USERS.ba)('applyChangeImpact', {
      projectId: h.projectId,
      processId: h.processId,
      summary: result.assessment!.summary,
      items: result.impact.items.map((i) => ({
        id: i.id,
        type: i.type,
        refCode: i.refCode,
        reason: i.reasons[0]!,
        impact: 'high',
      })),
    });
    const after = h.tables.stories.find((s) => s.id === functional.id)!;
    expect(after.reviewFlag).toMatch(/Linked to/);
    expect({ ...after, reviewFlag: null, revision: 0, updatedAt: '' }).toEqual({ ...before, revision: 0, updatedAt: '' });
    expect(h.tables.stories.find((s) => s.id === tech.id)!.reviewFlag).toMatch(/Implements US-001/);
    expect(h.tables.insights).toHaveLength(1);

    // Pure function agrees with the operation.
    const snapshot = await client(h, USERS.ba)('snapshot', { projectId: h.projectId });
    expect(analyseChangeImpact(h.context, snapshot, h.processId, 'ver-1', v2).items).toHaveLength(2);
  });

  it('records improvement recommendations for review', async () => {
    const h = createDeliveryHarness();
    const result = await client(h, USERS.po)('suggestImprovements', { processId: h.processId });
    expect(result.insights.length).toBeGreaterThan(0);
    expect(result.insights.every((i) => i.status === 'open' && i.kind === 'improvement')).toBe(true);
    const decided = await client(h, USERS.po)('decideInsight', { insightId: result.insights[0]!.id, status: 'accepted' });
    expect(decided.decidedBy).toBe(USERS.po);
    await rejects(client(h, USERS.dev)('suggestImprovements', { processId: h.processId }), '42501');
  });

  it('refines a story into a proposal without saving it', async () => {
    const h = createDeliveryHarness();
    const story = await backlogStory(h);
    const { refinement } = await client(h, USERS.ba)('refineStory', { storyId: story.id });
    expect(refinement.issues.length).toBeGreaterThan(0);
    expect(refinement.refined.acceptanceCriteria.length).toBe(story.acceptanceCriteria.length + 1);
    expect(h.tables.stories[0]!.revision).toBe(story.revision);
  });

  it('rejects unknown operations and invalid input', async () => {
    const h = createDeliveryHarness();
    await rejects(runDeliveryOp(h.ctx(USERS.admin), 'dropEverything', {}), 'invalid_request');
    await rejects(runDeliveryOp(h.ctx(USERS.admin), 'createSprint', { projectId: h.projectId, name: 'S' }), 'invalid_request');
    await rejects(runDeliveryOp(h.ctx(USERS.admin), 'toString', {}), 'invalid_request');
  });
});
