import { analysisToProposal, resolveProposalActors, type FieldDefinition } from '@productflow/domain';
import {
  DEBT_WRITE_OFF_ANALYSIS,
  DEBT_WRITE_OFF_DESCRIPTION,
  fieldSuggestionsForPrompt,
  OUTSTANDING_AMOUNT_RULE_TEXT,
  OUTSTANDING_AMOUNT_TRANSLATION,
} from '@productflow/domain/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisOutcome, ProcessAnalyser, StructuredOutcome, StructuredRunner, StructuredTask } from '../ai/analyser';
import type {
  AiTaskRunRecord,
  AnalysisRunRecord,
  Authenticator,
  FieldContext,
  UserRepository,
  VersionContext,
} from '../repository';
import { buildServer } from '../server';

const VERSION_ID = '6f1c1c39-62a4-4a0e-9c5b-8c4f0d2f6a11';
const FIELD_ID = '0b3c7a1e-8d2f-4f6a-9c1b-2e5d7f9a1c33';

const proposal = analysisToProposal(DEBT_WRITE_OFF_ANALYSIS);
const actors = proposal.actors.map((a, i) => ({ id: `actor-${i}`, ...a }));
const graph = resolveProposalActors(proposal, actors);
const amountField: FieldDefinition = {
  id: FIELD_ID,
  refCode: 'FLD-002',
  name: 'Outstanding Amount',
  description: '',
  dataType: 'currency',
  allowedValues: [],
  defaultValue: '',
  source: 'retrieved',
  sourceDetail: 'Debt record',
  status: 'approved',
  origin: 'manual',
  revision: 1,
};

/** A runner that answers like Claude would, still going through each task's own parser. */
function fakeRunner(answer: (task: StructuredTask<unknown>) => unknown, fail?: StructuredOutcome<unknown>): StructuredRunner {
  return {
    run: vi.fn(async <T>(task: StructuredTask<T>): Promise<StructuredOutcome<T>> => {
      if (fail) return fail as StructuredOutcome<T>;
      const parsed = task.parse(JSON.stringify(answer(task as StructuredTask<unknown>)));
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
const DESCRIPTION = 'When a Finance Officer receives a request for debt write-off, the officer retrieves the debt record.';

function setup(
  opts: {
    context?: Partial<VersionContext> | null;
    outcome?: AnalysisOutcome;
    field?: Partial<FieldContext> | null;
    runner?: StructuredRunner;
  } = {},
) {
  const runs: AnalysisRunRecord[] = [];
  const aiRuns: AiTaskRunRecord[] = [];
  const context: VersionContext | null =
    opts.context === null
      ? null
      : {
          versionId: VERSION_ID,
          processId: 'p1',
          projectId: 'proj1',
          processName: 'Debt write-off',
          processType: 'to_be',
          status: 'draft',
          role: 'business_analyst',
          ...opts.context,
        };
  const repo: UserRepository = {
    userId: 'user-1',
    getVersionContext: vi.fn(async () => context),
    recordAnalysisRun: vi.fn(async (run) => {
      runs.push(run);
      return 'run-1';
    }),
    getProcessDataContext: vi.fn(async () => ({
      description: DEBT_WRITE_OFF_DESCRIPTION,
      graph,
      actors,
      dictionary: [amountField],
      businessRules: ['A debt must be outstanding for more than five years.'],
      requirements: { fields: [], outputs: [] },
    })),
    getFieldContext: vi.fn(async () =>
      opts.field === null
        ? null
        : { projectId: 'proj1', role: 'business_analyst' as const, field: amountField, dictionary: [amountField], ...opts.field },
    ),
    recordAiTaskRun: vi.fn(async (run) => {
      aiRuns.push(run);
      return 'ai-run-1';
    }),
  };
  const authenticator: Authenticator = {
    authenticate: vi.fn(async (token) => (token === 'good-token' ? repo : null)),
  };
  const outcome: AnalysisOutcome = opts.outcome ?? {
    ok: true,
    analysis: DEBT_WRITE_OFF_ANALYSIS,
    model: 'claude-opus-5-5',
    promptVersion: 'process-analysis/v1',
    usage: { inputTokens: 1, outputTokens: 2, attempts: 1 },
  };
  const analyser: ProcessAnalyser = { analyse: vi.fn(async () => outcome) };
  const runner =
    opts.runner ??
    fakeRunner((task) =>
      task.promptVersion.startsWith('field') ? fieldSuggestionsForPrompt(task.user) : OUTSTANDING_AMOUNT_TRANSLATION,
    );
  const app = buildServer({ analyser, runner, authenticator, corsOrigin: 'http://localhost:5173' });
  return { app, runs, aiRuns, analyser, runner, repo };
}

const post = (app: ReturnType<typeof setup>['app'], body: unknown, token: string | null = 'good-token') =>
  app.inject({
    method: 'POST',
    url: '/api/process-analysis',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: body as object,
  });

let current: ReturnType<typeof setup> | null = null;
afterEach(async () => {
  await current?.app.close();
  current = null;
});

describe('POST /api/process-analysis', () => {
  it('returns a proposal and records the run', async () => {
    current = setup();
    const res = await post(current.app, { versionId: VERSION_ID, description: DESCRIPTION });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runId).toBe('run-1');
    expect(body.proposal.nodes).toHaveLength(8);
    expect(body.proposal.actors.map((a: { name: string }) => a.name)).toContain('Supervisor');
    expect(current.runs).toHaveLength(1);
    expect(current.runs[0]).toMatchObject({
      succeeded: true,
      descriptionSnapshot: DESCRIPTION,
      versionId: VERSION_ID,
      error: null,
    });
    expect(current.analyser.analyse).toHaveBeenCalledWith({
      description: DESCRIPTION,
      processName: 'Debt write-off',
      processType: 'to_be',
    });
  });

  it('requires a valid session', async () => {
    current = setup();
    expect((await post(current.app, { versionId: VERSION_ID, description: DESCRIPTION }, null)).statusCode).toBe(401);
    const expired = await post(current.app, { versionId: VERSION_ID, description: DESCRIPTION }, 'expired');
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('unauthenticated');
    expect(current.analyser.analyse).not.toHaveBeenCalled();
  });

  it('validates the request body', async () => {
    current = setup();
    expect((await post(current.app, { versionId: 'nope', description: DESCRIPTION })).statusCode).toBe(400);
    const short = await post(current.app, { versionId: VERSION_ID, description: 'too short' });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.message).toMatch(/at least/);
    const long = await post(current.app, { versionId: VERSION_ID, description: 'x'.repeat(20001) });
    expect(long.statusCode).toBe(400);
  });

  it('returns 404 when the version is not visible to the user', async () => {
    current = setup({ context: null });
    expect((await post(current.app, { versionId: VERSION_ID, description: DESCRIPTION })).statusCode).toBe(404);
  });

  it.each(['developer', 'business_user', 'product_owner', null] as const)('rejects role %s', async (role) => {
    current = setup({ context: { role } });
    const res = await post(current.app, { versionId: VERSION_ID, description: DESCRIPTION });
    expect(res.statusCode).toBe(403);
    expect(current.analyser.analyse).not.toHaveBeenCalled();
  });

  it('refuses to analyse approved versions', async () => {
    current = setup({ context: { status: 'approved' } });
    const res = await post(current.app, { versionId: VERSION_ID, description: DESCRIPTION });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('version_locked');
  });

  it('records failed runs and returns a readable error', async () => {
    current = setup({
      outcome: {
        ok: false,
        kind: 'invalid_output',
        message: 'Claude returned a process model that failed validation.',
        model: 'claude-opus-5-5',
        promptVersion: 'process-analysis/v1',
        usage: { inputTokens: 1, outputTokens: 1, attempts: 2 },
        rawOutput: 'garbage',
      },
    });
    const res = await post(current.app, { versionId: VERSION_ID, description: DESCRIPTION });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'analysis_invalid_output' }, runId: 'run-1' });
    expect(current.runs[0]).toMatchObject({ succeeded: false, response: 'garbage' });
  });
});

describe('GET /api/health', () => {
  it('responds', async () => {
    current = setup();
    const res = await current.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

const postTo = (app: ReturnType<typeof setup>['app'], url: string, body: unknown, token = 'good-token') =>
  app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload: body as object });

describe('POST /api/field-suggestions', () => {
  it('suggests fields for every activity, reusing dictionary fields, and records the run', async () => {
    current = setup();
    const res = await postTo(current.app, '/api/field-suggestions', { versionId: VERSION_ID });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runId).toBe('ai-run-1');
    const newNames = body.proposal.newFields.map((f: { name: string }) => f.name);
    expect(newNames).toContain('Write-Off Reason');
    expect(newNames).not.toContain('Outstanding Amount');
    expect(body.proposal.fields.some((f: { existingFieldId: string }) => f.existingFieldId === FIELD_ID)).toBe(true);
    expect(current.aiRuns[0]).toMatchObject({ task: 'field_suggestions', subjectId: VERSION_ID, succeeded: true });
    expect(current.aiRuns[0]!.input).toContain('FLD-002 Outstanding Amount (currency)');
    expect(current.aiRuns[0]!.input).toContain('A debt must be outstanding for more than five years.');
  });

  it('limits the request to selected activities', async () => {
    current = setup();
    const submit = graph.nodes.find((n) => n.label === 'Submit request to supervisor')!.elementKey;
    const res = await postTo(current.app, '/api/field-suggestions', { versionId: VERSION_ID, nodeKeys: [submit] });
    expect(res.statusCode).toBe(200);
    const nodeKeys = new Set(res.json().proposal.fields.map((f: { nodeKey: string }) => f.nodeKey));
    expect([...nodeKeys]).toEqual([submit]);
  });

  it('enforces role and draft status', async () => {
    current = setup({ context: { role: 'developer' } });
    expect((await postTo(current.app, '/api/field-suggestions', { versionId: VERSION_ID })).statusCode).toBe(403);
    await current.app.close();
    current = setup({ context: { status: 'approved' } });
    expect((await postTo(current.app, '/api/field-suggestions', { versionId: VERSION_ID })).statusCode).toBe(409);
    expect(current.runner.run).not.toHaveBeenCalled();
  });

  it('reports AI failures with the run id', async () => {
    current = setup({
      runner: fakeRunner(() => null, {
        ok: false,
        kind: 'rate_limited',
        message: 'The AI service is busy.',
        model: 'claude-opus-5-5',
        promptVersion: 'field-suggestions/v1',
        usage: { inputTokens: 0, outputTokens: 0, attempts: 1 },
        rawOutput: null,
      }),
    });
    const res = await postTo(current.app, '/api/field-suggestions', { versionId: VERSION_ID });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: { code: 'ai_rate_limited' }, runId: 'ai-run-1' });
    expect(current.aiRuns[0]!.succeeded).toBe(false);
  });
});

describe('POST /api/rule-translation', () => {
  it('translates natural language into draft rules and business rules', async () => {
    current = setup();
    const res = await postTo(current.app, '/api/rule-translation', { fieldId: FIELD_ID, text: OUTSTANDING_AMOUNT_RULE_TEXT });
    expect(res.statusCode).toBe(200);
    const { proposal } = res.json();
    expect(proposal.rules[0]).toMatchObject({ ruleType: 'range', params: { min: 0, exclusive: true } });
    expect(proposal.businessRules[0].category).toBe('approval');
    expect(current.aiRuns[0]).toMatchObject({
      task: 'rule_translation',
      subjectId: FIELD_ID,
      input: OUTSTANDING_AMOUNT_RULE_TEXT,
    });
  });

  it('validates input, visibility and role', async () => {
    current = setup();
    expect((await postTo(current.app, '/api/rule-translation', { fieldId: FIELD_ID, text: 'x' })).statusCode).toBe(400);
    await current.app.close();
    current = setup({ field: null });
    expect(
      (await postTo(current.app, '/api/rule-translation', { fieldId: FIELD_ID, text: OUTSTANDING_AMOUNT_RULE_TEXT })).statusCode,
    ).toBe(404);
    await current.app.close();
    current = setup({ field: { role: 'product_owner' } });
    expect(
      (await postTo(current.app, '/api/rule-translation', { fieldId: FIELD_ID, text: OUTSTANDING_AMOUNT_RULE_TEXT })).statusCode,
    ).toBe(403);
  });
});

describe('serving the web app', () => {
  it('serves files and falls back to index.html for app routes, but not for /api', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const root = mkdtempSync(join(tmpdir(), 'web-'));
    writeFileSync(join(root, 'index.html'), '<div id="root"></div>');
    writeFileSync(join(root, 'app.js'), 'console.log(1)');
    const app = buildServer({
      analyser: {} as ProcessAnalyser,
      runner: fakeRunner(() => ({})),
      authenticator: { authenticate: async () => null },
      corsOrigin: '*',
      webRoot: root,
    });
    expect((await app.inject({ url: '/app.js' })).body).toBe('console.log(1)');
    expect((await app.inject({ url: '/projects/abc/stories' })).body).toContain('id="root"');
    expect((await app.inject({ url: '/api/health' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ url: '/api/nope' })).statusCode).toBe(404);
  });
});
