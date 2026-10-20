import type { Origin } from '../process/types';

/**
 * Phase 2: data requirements. A project keeps one data dictionary of logical
 * business fields. Process activities reference dictionary fields as inputs
 * or outputs; the same field can be used by many activities. Logical fields
 * are mapped to physical columns separately, many-to-many, because a
 * business field is not necessarily one database column.
 */

export const DATA_TYPES = [
  'string',
  'text',
  'integer',
  'decimal',
  'currency',
  'date',
  'datetime',
  'boolean',
  'enum',
  'file',
  'reference',
] as const;
export type DataType = (typeof DATA_TYPES)[number];

export const DATA_TYPE_LABELS: Record<DataType, string> = {
  string: 'String',
  text: 'Text (long)',
  integer: 'Integer',
  decimal: 'Decimal',
  currency: 'Currency',
  date: 'Date',
  datetime: 'Date & time',
  boolean: 'Yes/No',
  enum: 'List of values',
  file: 'File',
  reference: 'Reference to record',
};

export const FIELD_SOURCES = ['user_entered', 'system_generated', 'retrieved'] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

export const FIELD_SOURCE_LABELS: Record<FieldSource, string> = {
  user_entered: 'User-entered',
  system_generated: 'System-generated',
  retrieved: 'Retrieved from another source',
};

/** Draft: proposed (e.g. by AI) and not yet confirmed by an analyst. */
export const FIELD_STATUSES = ['draft', 'approved', 'deprecated'] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

export interface FieldDefinition {
  id: string;
  /** Human-readable identifier, e.g. FLD-007. */
  refCode: string;
  name: string;
  description: string;
  dataType: DataType;
  /** Values for `enum` fields. */
  allowedValues: string[];
  defaultValue: string;
  source: FieldSource;
  /** Where a retrieved field comes from, or how a system field is generated. */
  sourceDetail: string;
  status: FieldStatus;
  origin: Origin;
  revision: number;
}

export const MANDATORY_OPTIONS = ['yes', 'no', 'conditional'] as const;
export type Mandatory = (typeof MANDATORY_OPTIONS)[number];

export const IO_DIRECTIONS = ['input', 'output'] as const;
export type IoDirection = (typeof IO_DIRECTIONS)[number];

/** A dictionary field used by one process activity, in one process version. */
export interface ActivityField {
  elementKey: string;
  /** The activity's element key in the process map. */
  nodeKey: string;
  fieldId: string;
  direction: IoDirection;
  mandatory: Mandatory;
  /** When `mandatory` is conditional: the condition, in plain language. */
  mandatoryCondition: string;
  notes: string;
  origin: Origin;
  sortOrder: number;
}

export const OUTPUT_KINDS = ['record_update', 'document', 'notification', 'status_change'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

export const OUTPUT_KIND_LABELS: Record<OutputKind, string> = {
  record_update: 'Updated record',
  document: 'Generated document',
  notification: 'Notification',
  status_change: 'Status change',
};

/** An activity outcome that is not a field: an updated record, document, notification or status change. */
export interface ActivityOutput {
  elementKey: string;
  nodeKey: string;
  kind: OutputKind;
  /** The record, document, recipient or new status. */
  target: string;
  description: string;
  origin: Origin;
  sortOrder: number;
}

export const RULE_TYPES = [
  'required',
  'format',
  'range',
  'length',
  'conditional_required',
  'cross_field',
  'lookup',
  'duplicate',
  'custom',
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  required: 'Required',
  format: 'Format',
  range: 'Minimum / maximum',
  length: 'Length',
  conditional_required: 'Conditionally required',
  cross_field: 'Cross-field',
  lookup: 'Lookup',
  duplicate: 'Duplicate check',
  custom: 'Custom business rule',
};

/** Structured parameters of a validation rule. Which ones apply depends on the rule type. */
export interface RuleParams {
  min: number | null;
  max: number | null;
  /** Whether min/max are exclusive (greater than, rather than at least). */
  exclusive: boolean;
  minLength: number | null;
  maxLength: number | null;
  /** A regular expression or a named format such as "email". */
  pattern: string | null;
  /** For conditional and cross-field rules: the condition in plain language. */
  condition: string | null;
  /** For cross-field rules: the other field. */
  otherFieldId: string | null;
  /** For lookups and duplicate checks: the records checked against. */
  lookupSource: string | null;
}

export const EMPTY_RULE_PARAMS: RuleParams = {
  min: null,
  max: null,
  exclusive: false,
  minLength: null,
  maxLength: null,
  pattern: null,
  condition: null,
  otherFieldId: null,
  lookupSource: null,
};

export const RULE_STATUSES = ['draft', 'confirmed'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export interface ValidationRule {
  id: string;
  refCode: string;
  fieldId: string;
  ruleType: RuleType;
  params: RuleParams;
  /** The rule as a precise sentence, e.g. "Outstanding amount must be greater than zero." */
  statement: string;
  errorMessage: string;
  /** The analyst's original wording, when the rule was translated by AI. */
  sourceText: string | null;
  origin: Origin;
  status: RuleStatus;
  /** The business rule this validation enforces, if any. */
  businessRuleId: string | null;
}

export const BUSINESS_RULE_CATEGORIES = ['eligibility', 'approval', 'calculation', 'validation', 'policy', 'other'] as const;
export type BusinessRuleCategory = (typeof BUSINESS_RULE_CATEGORIES)[number];

export const BUSINESS_RULE_CATEGORY_LABELS: Record<BusinessRuleCategory, string> = {
  eligibility: 'Eligibility',
  approval: 'Approval',
  calculation: 'Calculation',
  validation: 'Validation',
  policy: 'Policy',
  other: 'Other',
};

export const BUSINESS_RULE_STATUSES = ['draft', 'approved', 'retired'] as const;
export type BusinessRuleStatus = (typeof BUSINESS_RULE_STATUSES)[number];

export interface BusinessRuleActivityLink {
  processId: string;
  nodeKey: string;
}

export interface BusinessRule {
  id: string;
  refCode: string;
  title: string;
  statement: string;
  category: BusinessRuleCategory;
  status: BusinessRuleStatus;
  origin: Origin;
  /** The process finding this rule was promoted from, for traceability. */
  sourceFinding: { versionId: string; elementKey: string } | null;
  activities: BusinessRuleActivityLink[];
  revision: number;
}

export interface PhysicalColumn {
  id: string;
  systemName: string;
  tableName: string;
  columnName: string;
  dataType: string;
  notes: string;
}

export interface FieldColumnMapping {
  fieldId: string;
  columnId: string;
  /** How the business field is derived from the column, if not one-to-one. */
  transformation: string;
}

/** The inputs and outputs of every activity in one process version. */
export interface VersionDataRequirements {
  fields: ActivityField[];
  outputs: ActivityOutput[];
}
