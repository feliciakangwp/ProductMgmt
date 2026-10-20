import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  analysisToProposal,
  buildFieldSuggestionPrompt,
  buildRuleTranslationPrompt,
  buildSuggestionContext,
  can,
  DomainError,
  runDeliveryOp,
  FIELD_SUGGESTION_PROMPT_VERSION,
  fieldSuggestionsJsonSchema,
  parseFieldSuggestions,
  parseRuleTranslation,
  RULE_TRANSLATION_PROMPT_VERSION,
  ruleTranslationJsonSchema,
  suggestionsToProposal,
  translationToProposal,
} from '@productflow/domain';
import type { AiFailureKind, ProcessAnalyser, StructuredOutcome, StructuredRunner } from './ai/analyser';
import { AppError } from './errors';
import { createAiGateway, type ApiDeliveryStore } from './delivery';
import type { Authenticator, UserRepository } from './repository';

export interface ServerDeps {
  analyser: ProcessAnalyser;
  /** Runs the Phase 2 structured AI tasks. */
  runner: StructuredRunner;
  authenticator: Authenticator;
  /** Storage for the delivery modules (Phases 3 to 7). Without it those requests answer 503. */
  deliveryStore?: ApiDeliveryStore;
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

const FieldSuggestionBody = z.object({
  versionId: z.uuid(),
  nodeKeys: z.array(z.uuid()).max(100).optional(),
});

const RuleTranslationBody = z.object({
  fieldId: z.uuid(),
  text: z
    .string()
    .trim()
    .min(5, 'Describe the validation logic first.')
    .max(4000, 'The validation logic must be 4000 characters or fewer.'),
});

const FIELD_SCHEMA = fieldSuggestionsJsonSchema();
const RULE_SCHEMA = ruleTranslationJsonSchema();

const FAILURE_STATUS: Record<AiFailureKind, number> = {
  refusal: 422,
  truncated: 422,
  invalid_output: 502,
  rate_limited: 429,
  unavailable: 503,
  configuration: 500,
};

const DOMAIN_STATUS: Record<string, number> = {
  P0002: 404,
  '42501': 403,
  PF409: 409,
  PF422: 422,
  PF423: 423,
  invalid_request: 400,
};

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 256 * 1024 });

  app.register(cors, { origin: deps.corsOrigin, methods: ['GET', 'POST'] });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      const status = error.code.startsWith('ai_')
        ? (FAILURE_STATUS[error.code.slice(3) as AiFailureKind] ?? 502)
        : (DOMAIN_STATUS[error.code] ?? 400);
      return reply.status(status).send({ error: { code: error.code, message: error.message } });
    }
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

  function failure(reply: FastifyReply, outcome: Extract<StructuredOutcome<unknown>, { ok: false }>, runId: string) {
    return reply
      .status(FAILURE_STATUS[outcome.kind])
      .send({ error: { code: `ai_${outcome.kind}`, message: outcome.message }, runId });
  }

  app.post('/api/field-suggestions', async (request, reply) => {
    const repo = await requireUser(request);
    const parsed = FieldSuggestionBody.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request.');
    const { versionId, nodeKeys } = parsed.data;

    const context = await repo.getVersionContext(versionId);
    if (!context) throw new AppError(404, 'not_found', 'Process version not found.');
    if (!can(context.role, 'editData')) {
      throw new AppError(403, 'forbidden', 'Only Business Analysts and Administrators can define data requirements.');
    }
    if (context.status !== 'draft') {
      throw new AppError(
        409,
        'version_locked',
        'This version is not a draft. Create a new draft to change its data requirements.',
      );
    }

    const data = await repo.getProcessDataContext(context);
    const { context: promptContext, keyByActivityId } = buildSuggestionContext({
      processName: context.processName,
      description: data.description,
      graph: data.graph,
      actors: data.actors,
      dictionary: data.dictionary,
      businessRules: data.businessRules,
      nodeKeys,
    });
    if (keyByActivityId.size === 0) {
      throw new AppError(422, 'no_activities', 'The process map has no activities to define data for. Create the map first.');
    }
    const prompt = buildFieldSuggestionPrompt(promptContext);
    const ids = new Set(keyByActivityId.keys());
    const outcome = await deps.runner.run({
      ...prompt,
      schema: FIELD_SCHEMA,
      parse: (raw) => parseFieldSuggestions(raw, ids),
      promptVersion: FIELD_SUGGESTION_PROMPT_VERSION,
    });
    const runId = await repo.recordAiTaskRun({
      projectId: context.projectId,
      task: 'field_suggestions',
      subjectId: versionId,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
      succeeded: outcome.ok,
      input: prompt.user,
      response: outcome.ok ? outcome.value : outcome.rawOutput,
      error: outcome.ok ? null : `${outcome.kind}: ${outcome.message}`,
      usage: outcome.usage,
    });
    if (!outcome.ok) return failure(reply, outcome, runId);
    return {
      runId,
      model: outcome.model,
      proposal: suggestionsToProposal(outcome.value, {
        keyByActivityId,
        dictionary: data.dictionary,
        current: data.requirements,
      }),
    };
  });

  app.post('/api/rule-translation', async (request, reply) => {
    const repo = await requireUser(request);
    const parsed = RuleTranslationBody.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Invalid request.');
    const { fieldId, text } = parsed.data;

    const context = await repo.getFieldContext(fieldId);
    if (!context) throw new AppError(404, 'not_found', 'Field not found.');
    if (!can(context.role, 'editData')) {
      throw new AppError(403, 'forbidden', 'Only Business Analysts and Administrators can define validation rules.');
    }
    const { field, dictionary } = context;
    const prompt = buildRuleTranslationPrompt({
      field: {
        refCode: field.refCode,
        name: field.name,
        dataType: field.dataType,
        description: field.description,
        allowedValues: field.allowedValues,
      },
      otherFields: dictionary
        .filter((f) => f.id !== field.id && f.status !== 'deprecated')
        .map((f) => ({ refCode: f.refCode, name: f.name, dataType: f.dataType })),
      text,
    });
    const outcome = await deps.runner.run({
      ...prompt,
      schema: RULE_SCHEMA,
      parse: parseRuleTranslation,
      promptVersion: RULE_TRANSLATION_PROMPT_VERSION,
    });
    const runId = await repo.recordAiTaskRun({
      projectId: context.projectId,
      task: 'rule_translation',
      subjectId: fieldId,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
      succeeded: outcome.ok,
      input: text,
      response: outcome.ok ? outcome.value : outcome.rawOutput,
      error: outcome.ok ? null : `${outcome.kind}: ${outcome.message}`,
      usage: outcome.usage,
    });
    if (!outcome.ok) return failure(reply, outcome, runId);
    return { runId, model: outcome.model, proposal: translationToProposal(outcome.value, dictionary) };
  });

  // Delivery (Phases 3 to 7): one route per service operation. The service
  // checks the caller's project role and the workflow rules on every call.
  app.post<{ Params: { op: string } }>('/api/delivery/:op', { bodyLimit: 3 * 1024 * 1024 }, async (request) => {
    const repo = await requireUser(request);
    const store = deps.deliveryStore;
    if (!store) {
      throw new AppError(
        503,
        'delivery_unavailable',
        'Delivery features are not configured on this server (SUPABASE_SERVICE_ROLE_KEY).',
      );
    }
    const result = await runDeliveryOp(
      {
        store,
        userId: repo.userId,
        ai: createAiGateway(deps.runner, (run) => store.recordAiRun(run), repo.userId),
        now: () => new Date().toISOString(),
        newId: () => globalThis.crypto.randomUUID(),
      },
      request.params.op,
      request.body ?? {},
    );
    return { result: result ?? null };
  });

  return app;
}
