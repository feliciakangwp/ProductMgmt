import { z } from 'zod';
import { AI_ORIGINS, parseJsonWithSchema, structuredOutputSchema, type ParseResult } from '../process/ai-schema';
import { BUSINESS_RULE_CATEGORIES, DATA_TYPES, FIELD_SOURCES, MANDATORY_OPTIONS, OUTPUT_KINDS, RULE_TYPES } from './types';

/**
 * Contracts for the two Phase 2 AI tasks: proposing the inputs and outputs
 * of process activities, and translating natural-language validation logic
 * into structured rules. As in Phase 1, the zod schema is both the
 * structured-output schema sent to Claude and the runtime validator.
 */

export const SuggestedFieldSchema = z.strictObject({
  name: z.string().describe('Business name of the field, e.g. "Outstanding Amount"'),
  existingFieldRef: z
    .string()
    .nullable()
    .describe('Ref code of an existing dictionary field to reuse (e.g. "FLD-003"), or null for a new field'),
  dataType: z.enum(DATA_TYPES),
  allowedValues: z.array(z.string()).describe('Values for enum fields; empty otherwise'),
  description: z.string(),
  source: z.enum(FIELD_SOURCES),
  sourceDetail: z.string().describe('For retrieved or system-generated fields: where the value comes from; empty otherwise'),
  mandatory: z.enum(MANDATORY_OPTIONS),
  mandatoryCondition: z.string().describe('When mandatory is "conditional": the condition; empty otherwise'),
  origin: z.enum(AI_ORIGINS).describe('"stated" if the description names this data, "inferred" otherwise'),
  rationale: z.string().describe('One short sentence on why the activity needs this field'),
});

export const SuggestedOutputSchema = z.strictObject({
  kind: z.enum(OUTPUT_KINDS),
  target: z.string().describe('The record updated, document generated, recipient notified, or new status'),
  description: z.string(),
  origin: z.enum(AI_ORIGINS),
});

export const ActivitySuggestionSchema = z.strictObject({
  activityId: z.string().describe('The id of the activity from the list provided, e.g. "A3"'),
  inputs: z.array(SuggestedFieldSchema),
  outputFields: z.array(SuggestedFieldSchema),
  otherOutputs: z.array(SuggestedOutputSchema),
});

export const FieldSuggestionsSchema = z.strictObject({
  activities: z.array(ActivitySuggestionSchema),
  questions: z.array(z.string()).describe('Questions for the analyst about data the description leaves open'),
});

export type SuggestedField = z.infer<typeof SuggestedFieldSchema>;
export type FieldSuggestions = z.infer<typeof FieldSuggestionsSchema>;

export const TranslatedRuleSchema = z.strictObject({
  ruleType: z.enum(RULE_TYPES),
  statement: z.string().describe('The rule as one precise, testable sentence'),
  errorMessage: z.string().describe('The message shown to a user when the rule fails'),
  min: z.number().nullable(),
  max: z.number().nullable(),
  exclusive: z.boolean().describe('true when min/max are exclusive ("greater than"), false for "at least"'),
  minLength: z.number().nullable(),
  maxLength: z.number().nullable(),
  pattern: z.string().nullable().describe('A regular expression or a named format such as "email"'),
  condition: z.string().nullable().describe('For conditional and cross-field rules: the condition'),
  otherFieldRef: z.string().nullable().describe('For cross-field rules: ref code of the other field'),
  lookupSource: z.string().nullable().describe('For lookup and duplicate rules: the records checked against'),
});

export const TranslatedBusinessRuleSchema = z.strictObject({
  title: z.string(),
  statement: z.string(),
  category: z.enum(BUSINESS_RULE_CATEGORIES),
});

export const RuleTranslationSchema = z.strictObject({
  rules: z.array(TranslatedRuleSchema),
  businessRules: z
    .array(TranslatedBusinessRuleSchema)
    .describe('Policy that goes beyond validating this field, such as an approval threshold'),
  questions: z.array(z.string()),
});

export type TranslatedRule = z.infer<typeof TranslatedRuleSchema>;
export type RuleTranslation = z.infer<typeof RuleTranslationSchema>;

export function fieldSuggestionsJsonSchema(): Record<string, unknown> {
  return structuredOutputSchema(FieldSuggestionsSchema);
}

export function ruleTranslationJsonSchema(): Record<string, unknown> {
  return structuredOutputSchema(RuleTranslationSchema);
}

export function parseFieldSuggestions(raw: string, activityIds: Set<string>): ParseResult<FieldSuggestions> {
  const result = parseJsonWithSchema(raw, FieldSuggestionsSchema);
  if (!result.ok) return result;
  const errors = result.value.activities
    .map((a, i) => (activityIds.has(a.activityId) ? null : `activities.${i}.activityId: unknown activity "${a.activityId}"`))
    .filter((e): e is string => e !== null);
  return errors.length > 0 ? { ok: false, errors } : result;
}

export function parseRuleTranslation(raw: string): ParseResult<RuleTranslation> {
  const result = parseJsonWithSchema(raw, RuleTranslationSchema);
  if (!result.ok) return result;
  const errors: string[] = [];
  result.value.rules.forEach((r, i) => {
    if (r.min !== null && r.max !== null && r.min > r.max) errors.push(`rules.${i}: min is greater than max`);
    if (r.minLength !== null && r.maxLength !== null && r.minLength > r.maxLength) {
      errors.push(`rules.${i}: minLength is greater than maxLength`);
    }
  });
  return errors.length > 0 ? { ok: false, errors } : result;
}
