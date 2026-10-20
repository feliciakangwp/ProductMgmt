import { z } from 'zod';
import { ACTOR_KINDS, EDGE_BRANCHES, FINDING_KINDS, NODE_TYPES } from './types';

/**
 * Contract for Claude's process analysis response. The same schema is sent to
 * the API as a structured-output JSON schema and used to validate the reply
 * at runtime, so the two can never drift apart.
 */

export const AI_ORIGINS = ['stated', 'inferred'] as const;

export const AnalysisActorSchema = z.strictObject({
  name: z.string().describe('Role, system or external party, e.g. "Finance Officer"'),
  kind: z.enum(ACTOR_KINDS),
});

export const AnalysisStepSchema = z.strictObject({
  id: z.string().describe('Short unique id within this response, e.g. "S1"'),
  type: z.enum(NODE_TYPES),
  label: z.string().describe('Short verb phrase, e.g. "Retrieve debt record"; for decisions, a question'),
  description: z.string(),
  actor: z.string().nullable().describe('Name of the responsible actor from the actors list, or null if not stated'),
  origin: z.enum(AI_ORIGINS).describe('"stated" if explicit in the description, "inferred" otherwise'),
  sourceText: z.string().nullable().describe('Verbatim excerpt from the description supporting this step'),
});

export const AnalysisFlowSchema = z.strictObject({
  from: z.string(),
  to: z.string(),
  branch: z.enum(EDGE_BRANCHES).nullable().describe('For flows leaving a decision or approval: yes / no / other'),
  label: z.string().describe('Short label shown on the connector, may be empty'),
  condition: z.string().describe('Condition for taking this path, empty if unconditional'),
});

export const AnalysisFindingSchema = z.strictObject({
  kind: z.enum(FINDING_KINDS),
  statement: z.string(),
  sourceText: z.string().nullable(),
  origin: z.enum(AI_ORIGINS),
  relatedStepIds: z.array(z.string()),
});

export const ProcessAnalysisSchema = z.strictObject({
  processName: z.string(),
  summary: z.string(),
  actors: z.array(AnalysisActorSchema),
  steps: z.array(AnalysisStepSchema),
  flows: z.array(AnalysisFlowSchema),
  findings: z.array(AnalysisFindingSchema),
});

export type ProcessAnalysis = z.infer<typeof ProcessAnalysisSchema>;
export type AnalysisStep = z.infer<typeof AnalysisStepSchema>;

/** JSON schema form of {@link ProcessAnalysisSchema} for `output_config.format`. */
export function processAnalysisJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ProcessAnalysisSchema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  delete schema.$schema;
  return normaliseTypeUnions(schema) as Record<string, unknown>;
}

/** Rewrites `type: ["string", "null"]` as an explicit `anyOf`, the most widely supported form. */
function normaliseTypeUnions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normaliseTypeUnions);
  if (!node || typeof node !== 'object') return node;
  const { type, ...rest } = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) out[k] = normaliseTypeUnions(v);
  if (Array.isArray(type)) {
    out.anyOf = type.map((t) => ({ type: t }));
  } else if (type !== undefined) {
    out.type = type;
  }
  return out;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Parses raw model text into a validated analysis, collecting readable errors. */
export function parseProcessAnalysis(raw: string): ParseResult<ProcessAnalysis> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ok: false, errors: [`Response is not valid JSON: ${(err as Error).message}`] };
  }
  const result = ProcessAnalysisSchema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }
  const semanticErrors = checkAnalysisReferences(result.data);
  if (semanticErrors.length > 0) return { ok: false, errors: semanticErrors };
  return { ok: true, value: result.data };
}

/** Structural checks the JSON schema cannot express: unique ids and valid references. */
export function checkAnalysisReferences(analysis: ProcessAnalysis): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const step of analysis.steps) {
    if (ids.has(step.id)) errors.push(`steps: duplicate step id "${step.id}"`);
    ids.add(step.id);
  }
  analysis.flows.forEach((flow, i) => {
    if (!ids.has(flow.from)) errors.push(`flows.${i}.from: unknown step id "${flow.from}"`);
    if (!ids.has(flow.to)) errors.push(`flows.${i}.to: unknown step id "${flow.to}"`);
  });
  analysis.findings.forEach((finding, i) => {
    for (const ref of finding.relatedStepIds) {
      if (!ids.has(ref)) errors.push(`findings.${i}.relatedStepIds: unknown step id "${ref}"`);
    }
  });
  return errors;
}
