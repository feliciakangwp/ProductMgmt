import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { analysisToProposal, can } from '@productflow/domain';
import type { AnalysisFailureKind, ProcessAnalyser } from './ai/analyser';
import { AppError } from './errors';
import type { Authenticator, UserRepository } from './repository';

export interface ServerDeps {
  analyser: ProcessAnalyser;
  authenticator: Authenticator;
  corsOrigin: string | string[];
  logger?: boolean;
}

export const MAX_DESCRIPTION_LENGTH = 20000;

const AnalyseBody = z.object({
  versionId: z.uuid(),
  description: z
    .string()
    .trim()
    .min(20, 'Describe the process in at least a sentence or two before analysing it.')
    .max(MAX_DESCRIPTION_LENGTH, `The description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`),
});

const FAILURE_STATUS: Record<AnalysisFailureKind, number> = {
  refusal: 422,
  truncated: 422,
  invalid_output: 502,
  rate_limited: 429,
  unavailable: 503,
  configuration: 500,
};

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 256 * 1024 });

  app.register(cors, { origin: deps.corsOrigin, methods: ['GET', 'POST'] });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const err = error as { statusCode?: number; message?: string };
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: 'bad_request', message: err.message } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong on the server.' } });
  });

  async function requireUser(request: FastifyRequest): Promise<UserRepository> {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
    const repo = await deps.authenticator.authenticate(token);
    if (!repo) throw new AppError(401, 'unauthenticated', 'Your session has expired. Sign in again.');
    return repo;
  }

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.post('/api/process-analysis', async (request, reply) => {
    const repo = await requireUser(request);
    const parsed = AnalyseBody.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request.');
    }
    const { versionId, description } = parsed.data;

    const context = await repo.getVersionContext(versionId);
    if (!context) throw new AppError(404, 'not_found', 'Process version not found.');
    if (!can(context.role, 'runAnalysis')) {
      throw new AppError(403, 'forbidden', 'Only Business Analysts and Administrators can run process analysis.');
    }
    if (context.status !== 'draft') {
      throw new AppError(409, 'version_locked', 'This version is not a draft. Create a new draft to change the process.');
    }

    const outcome = await deps.analyser.analyse({
      description,
      processName: context.processName,
      processType: context.processType,
    });

    const runId = await repo.recordAnalysisRun({
      projectId: context.projectId,
      processId: context.processId,
      versionId,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
      succeeded: outcome.ok,
      descriptionSnapshot: description,
      response: outcome.ok ? outcome.analysis : outcome.rawOutput,
      error: outcome.ok ? null : `${outcome.kind}: ${outcome.message}`,
      usage: outcome.usage,
    });

    if (!outcome.ok) {
      return reply
        .status(FAILURE_STATUS[outcome.kind])
        .send({ error: { code: `analysis_${outcome.kind}`, message: outcome.message }, runId });
    }

    return { runId, model: outcome.model, proposal: analysisToProposal(outcome.analysis) };
  });

  return app;
}
