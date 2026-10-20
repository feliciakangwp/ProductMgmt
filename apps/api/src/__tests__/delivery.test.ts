import { createDeliveryHarness, deliveryAnswerFor, USERS } from '@productflow/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessAnalyser, StructuredOutcome, StructuredRunner, StructuredTask } from '../ai/analyser';
import { fromColumns, toColumns, type AiRunRecord, type ApiDeliveryStore } from '../delivery';
import type { Authenticator, UserRepository } from '../repository';
import { buildServer } from '../server';

function runner(fail?: StructuredOutcome<unknown>): StructuredRunner {
  return {
    run: vi.fn(async <T>(task: StructuredTask<T>): Promise<StructuredOutcome<T>> => {
      if (fail) return fail as StructuredOutcome<T>;
      const properties = (task.schema as { properties?: Record<string, unknown> }).properties ?? {};
      const parsed = task.parse(JSON.stringify(deliveryAnswerFor(properties, task.user)));
      if (!parsed.ok) throw new Error(parsed.errors.join('; '));
      return {
        ok: true,
        value: parsed.value,
        model: 'claude-opus-5-5',
        promptVersion: task.promptVersion,
        usage: { inputTokens: 1, outputTokens: 1, attempts: 1 },
      };
    }) as StructuredRunner['run'],
  };
}

/** Tokens are user ids in these tests. */
const authenticator: Authenticator = {
  async authenticate(token) {
    return Object.values(USERS).includes(token as never) ? ({ userId: token } as UserRepository) : null;
  },
};

function setup(opts: { store?: boolean; fail?: StructuredOutcome<unknown> } = {}) {
  const h = createDeliveryHarness();
  const aiRuns: AiRunRecord[] = [];
  const store: ApiDeliveryStore = { ...h.store, recordAiRun: async (run) => (aiRuns.push(run), `run-${aiRuns.length}`) };
  const app = buildServer({
    analyser: {} as ProcessAnalyser,
    runner: runner(opts.fail),
    authenticator,
    corsOrigin: '*',
    deliveryStore: opts.store === false ? undefined : store,
  });
  const call = (user: string | null, op: string, body: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/delivery/${op}`,
      headers: user ? { authorization: `Bearer ${user}` } : {},
      payload: body as object,
    });
  return { h, app, call, aiRuns };
}

describe('POST /api/delivery/:op', () => {
  it('requires a signed-in user and a configured store', async () => {
    const { h, call } = setup();
    expect((await call(null, 'snapshot', { projectId: h.projectId })).statusCode).toBe(401);
    const unconfigured = setup({ store: false });
    const res = await unconfigured.call(USERS.ba, 'snapshot', { projectId: h.projectId });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('delivery_unavailable');
  });

  it('runs operations with the caller as the actor and maps rule failures to HTTP statuses', async () => {
    const { h, call } = setup();
    const created = await call(USERS.ba, 'createStory', {
      projectId: h.projectId,
      storyType: 'functional',
      content: { title: 'Submit request' },
    });
    expect(created.statusCode).toBe(200);
    const story = created.json().result;
    expect(story).toMatchObject({ refCode: 'US-001', status: 'draft', createdBy: USERS.ba });

    const forbidden = await call(USERS.dev, 'createStory', {
      projectId: h.projectId,
      storyType: 'functional',
      content: { title: 'X' },
    });
    expect([forbidden.statusCode, forbidden.json().error.code]).toEqual([403, '42501']);
    const outsider = await call(USERS.outsider, 'snapshot', { projectId: h.projectId });
    expect([outsider.statusCode, outsider.json().error.code]).toEqual([404, 'P0002']);

    const ok = await call(USERS.ba, 'updateStory', { storyId: story.id, revision: 1, content: { title: 'Renamed' } });
    expect(ok.statusCode).toBe(200);
    const stale = await call(USERS.ba, 'updateStory', { storyId: story.id, revision: 1, content: { title: 'Stale' } });
    expect([stale.statusCode, stale.json().error.code]).toEqual([409, 'PF409']);
    const invalid = await call(USERS.ba, 'setStoryStatus', { storyId: story.id, revision: 2, status: 'pending_review' });
    expect([invalid.statusCode, invalid.json().error.code]).toEqual([422, 'PF422']);

    expect((await call(USERS.ba, 'nope', {})).statusCode).toBe(400);
    expect((await call(USERS.ba, 'createStory', { projectId: h.projectId })).json().error.code).toBe('invalid_request');
  });

  it('runs AI tasks through Claude and records each run', async () => {
    const { h, call, aiRuns } = setup();
    const res = await call(USERS.ba, 'generateStories', { projectId: h.projectId, processId: h.processId });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.stories).toHaveLength(3);
    expect(aiRuns).toHaveLength(1);
    expect(aiRuns[0]).toMatchObject({
      task: 'story_generation',
      userId: USERS.ba,
      succeeded: true,
      promptVersion: 'story-generation/v1',
    });
    expect(aiRuns[0]!.input).toContain('<context>');
  });

  it('reports AI failures with the failure kind', async () => {
    const { h, call, aiRuns } = setup({
      fail: {
        ok: false,
        kind: 'refusal',
        message: 'Claude declined.',
        model: 'm',
        promptVersion: 'v',
        usage: { inputTokens: 1, outputTokens: 0, attempts: 1 },
        rawOutput: null,
      },
    });
    const res = await call(USERS.ba, 'generateStories', { projectId: h.projectId, processId: h.processId });
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'ai_refusal']);
    expect(aiRuns[0]).toMatchObject({ succeeded: false, error: 'refusal: Claude declined.' });
  });
});

describe('column mapping', () => {
  it('maps top-level keys only', () => {
    const row = toColumns({
      refCode: 'US-1',
      acceptanceCriteria: [{ id: 'a', text: 'x' }],
      activities: [{ processId: 'p', nodeKey: 'n' }],
    });
    expect(row).toEqual({
      ref_code: 'US-1',
      acceptance_criteria: [{ id: 'a', text: 'x' }],
      activities: [{ processId: 'p', nodeKey: 'n' }],
    });
    expect(fromColumns(row)).toEqual({
      refCode: 'US-1',
      acceptanceCriteria: [{ id: 'a', text: 'x' }],
      activities: [{ processId: 'p', nodeKey: 'n' }],
    });
  });
});
