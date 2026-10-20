import type { FieldDefinition, Mandatory, ValidationRule } from '@productflow/domain';

export const MANDATORY_LABELS: Record<Mandatory, string> = { yes: 'Yes', no: 'No', conditional: 'Conditional' };

const num = (n: number) => n.toLocaleString();

/** A short summary of a rule's parameters, e.g. "> 0", "≤ 500 chars", "in Debt records". */
export function describeParams(rule: Pick<ValidationRule, 'ruleType' | 'params'>, fields: FieldDefinition[] = []): string {
  const p = rule.params;
  switch (rule.ruleType) {
    case 'range': {
      const parts: string[] = [];
      if (p.min !== null) parts.push(`${p.exclusive ? '>' : '≥'} ${num(p.min)}`);
      if (p.max !== null) parts.push(`${p.exclusive ? '<' : '≤'} ${num(p.max)}`);
      return parts.join(' and ');
    }
    case 'length': {
      const parts: string[] = [];
      if (p.minLength !== null) parts.push(`at least ${num(p.minLength)} chars`);
      if (p.maxLength !== null) parts.push(`at most ${num(p.maxLength)} chars`);
      return parts.join(', ');
    }
    case 'format':
      return p.pattern ? `matches ${p.pattern}` : '';
    case 'conditional_required':
      return p.condition ? `when ${p.condition}` : '';
    case 'cross_field': {
      const other = fields.find((f) => f.id === p.otherFieldId);
      return [other ? `with ${other.refCode} ${other.name}` : '', p.condition ?? ''].filter(Boolean).join(': ');
    }
    case 'lookup':
    case 'duplicate':
      return p.lookupSource ? `in ${p.lookupSource}` : '';
    default:
      return '';
  }
}
