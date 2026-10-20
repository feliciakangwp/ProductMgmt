import { DEBT_WRITE_OFF_ANALYSIS } from '@productflow/domain/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisOutcome, ProcessAnalyser } from '../ai/analyser';
import type { AnalysisRunRecord, Authenticator, UserRepository, VersionContext } from '../repository';
import { buildServer } from '../server';

const VERSION_ID = '6f1c1c39-62a4-4a0e-9c5b-8c4f0d2f6a11';
const DESCRIPTION = 'When a Finance Officer receives a request for debt write-off, the officer retrieves the debt record.';

function setup(opts: { context?: Partial<VersionContext> | null; outcome?: AnalysisOutcome } = {}) {
  const runs: AnalysisRunRecord[] = [];
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
  const app = buildServer({ analyser, authenticator, corsOrigin: 'http://localhost:5173' });
  return { app, runs, analyser, repo };
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
    expect(current.runs[0]).toMatchObject({ succeeded: true, descriptionSnapshot: DESCRIPTION, versionId: VERSION_ID, error: null });
    expect(current.analyser.analyse).toHaveBeenCalledWith({ description: DESCRIPTION, processName: 'Debt write-off', processType: 'to_be' });
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
