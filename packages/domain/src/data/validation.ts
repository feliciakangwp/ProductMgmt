import { normaliseName } from '../ids';
import type { ProcessGraph } from '../process/types';
import type { IssueSeverity } from '../process/validation';
import { dataActivities } from './suggestions';
import type { FieldDefinition, RuleParams, ValidationRule, VersionDataRequirements } from './types';

export type DataIssueCode =
  | 'ACTIVITY_WITHOUT_DATA'
  | 'CONDITION_MISSING'
  | 'FIELD_UNKNOWN'
  | 'FIELD_DRAFT'
  | 'FIELD_DEPRECATED'
  | 'ENUM_WITHOUT_VALUES'
  | 'RULE_DRAFT'
  | 'RULE_PARAMS_INVALID'
  | 'NODE_MISSING'
  | 'DUPLICATE_FIELD_NAME';

export interface DataIssue {
  id: string;
  code: DataIssueCode;
  severity: IssueSeverity;
  message: string;
  nodeKeys: string[];
  fieldIds: string[];
}

/** Problems in a rule's own parameters, independent of where it is used. */
export function ruleParamProblems(params: RuleParams): string[] {
  const problems: string[] = [];
  if (params.min !== null && params.max !== null && params.min > params.max)
    problems.push('the minimum is greater than the maximum');
  if (params.minLength !== null && params.maxLength !== null && params.minLength > params.maxLength) {
    problems.push('the minimum length is greater than the maximum length');
  }
  if ((params.minLength ?? 0) < 0 || (params.maxLength ?? 0) < 0) problems.push('a length cannot be negative');
  if (params.pattern && params.pattern.startsWith('/')) {
    try {
      const body = params.pattern.slice(1, params.pattern.lastIndexOf('/'));
      new RegExp(body);
    } catch {
      problems.push('the format pattern is not a valid regular expression');
    }
  }
  return problems;
}

/**
 * Validates the data requirements of one process version against its map
 * and the data dictionary. Errors should be fixed before approval; warnings
 * are reviewed and acknowledged.
 */
export function validateDataRequirements(input: {
  graph: ProcessGraph;
  requirements: VersionDataRequirements;
  fields: FieldDefinition[];
  rules: ValidationRule[];
}): DataIssue[] {
  const issues: DataIssue[] = [];
  const add = (code: DataIssueCode, severity: IssueSeverity, message: string, nodeKeys: string[] = [], fieldIds: string[] = []) =>
    issues.push({ id: [code, ...nodeKeys, ...fieldIds].join(':'), code, severity, message, nodeKeys, fieldIds });

  const nodeByKey = new Map(input.graph.nodes.map((n) => [n.elementKey, n]));
  const fieldById = new Map(input.fields.map((f) => [f.id, f]));
  const name = (key: string) => {
    const node = nodeByKey.get(key);
    return node ? `${node.refCode ? `${node.refCode} ` : ''}"${node.label}"` : 'A removed activity';
  };

  for (const activity of dataActivities(input.graph)) {
    if (activity.type === 'decision') continue;
    const hasData =
      input.requirements.fields.some((f) => f.nodeKey === activity.elementKey) ||
      input.requirements.outputs.some((o) => o.nodeKey === activity.elementKey);
    if (!hasData)
      add('ACTIVITY_WITHOUT_DATA', 'warning', `${name(activity.elementKey)} has no inputs or outputs defined.`, [
        activity.elementKey,
      ]);
  }

  const usedFieldIds = new Set<string>();
  for (const use of input.requirements.fields) {
    if (!nodeByKey.has(use.nodeKey)) {
      add('NODE_MISSING', 'error', 'A field is linked to an activity that is no longer in the process map.', [], [use.fieldId]);
      continue;
    }
    const field = fieldById.get(use.fieldId);
    if (!field) {
      add('FIELD_UNKNOWN', 'error', `${name(use.nodeKey)} uses a field that is not in the data dictionary.`, [use.nodeKey]);
      continue;
    }
    usedFieldIds.add(field.id);
    if (use.direction === 'input' && use.mandatory === 'conditional' && !use.mandatoryCondition.trim()) {
      add(
        'CONDITION_MISSING',
        'error',
        `${field.name} is conditionally mandatory in ${name(use.nodeKey)}, but the condition is not stated.`,
        [use.nodeKey],
        [field.id],
      );
    }
  }

  for (const id of usedFieldIds) {
    const field = fieldById.get(id)!;
    const where = input.requirements.fields.filter((f) => f.fieldId === id).map((f) => f.nodeKey);
    if (field.status === 'draft') {
      add(
        'FIELD_DRAFT',
        'warning',
        `${field.refCode} ${field.name} is still a draft. Confirm it in the data dictionary.`,
        where,
        [id],
      );
    } else if (field.status === 'deprecated') {
      add('FIELD_DEPRECATED', 'warning', `${field.refCode} ${field.name} is deprecated but still used.`, where, [id]);
    }
    if (field.dataType === 'enum' && field.allowedValues.length === 0) {
      add(
        'ENUM_WITHOUT_VALUES',
        'warning',
        `${field.refCode} ${field.name} is a list of values but no values are defined.`,
        where,
        [id],
      );
    }
    for (const rule of input.rules.filter((r) => r.fieldId === id)) {
      if (rule.status === 'draft') {
        add('RULE_DRAFT', 'warning', `Validation rule ${rule.refCode} on ${field.name} is not confirmed yet.`, where, [id]);
      }
      const problems = ruleParamProblems(rule.params);
      if (problems.length > 0) {
        add('RULE_PARAMS_INVALID', 'error', `Validation rule ${rule.refCode} on ${field.name}: ${problems.join('; ')}.`, where, [
          id,
        ]);
      }
    }
  }

  return issues;
}

/** Problems with the dictionary itself, such as two active fields with the same name. */
export function validateDictionary(fields: FieldDefinition[]): DataIssue[] {
  const issues: DataIssue[] = [];
  const byName = new Map<string, FieldDefinition[]>();
  for (const f of fields.filter((x) => x.status !== 'deprecated')) {
    const key = normaliseName(f.name);
    byName.set(key, [...(byName.get(key) ?? []), f]);
  }
  for (const same of byName.values()) {
    if (same.length > 1) {
      issues.push({
        id: `DUPLICATE_FIELD_NAME:${same.map((f) => f.id).join(':')}`,
        code: 'DUPLICATE_FIELD_NAME',
        severity: 'warning',
        message: `${same.map((f) => f.refCode).join(', ')} share the name "${same[0]!.name}". Merge them or rename one.`,
        nodeKeys: [],
        fieldIds: same.map((f) => f.id),
      });
    }
  }
  return issues;
}
