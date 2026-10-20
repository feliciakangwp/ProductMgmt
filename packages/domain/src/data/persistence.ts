import type { Origin } from '../process/types';
import {
  EMPTY_RULE_PARAMS,
  type ActivityField,
  type ActivityOutput,
  type BusinessRule,
  type BusinessRuleCategory,
  type BusinessRuleStatus,
  type DataType,
  type FieldDefinition,
  type FieldSource,
  type FieldStatus,
  type IoDirection,
  type Mandatory,
  type OutputKind,
  type PhysicalColumn,
  type RuleParams,
  type RuleStatus,
  type RuleType,
  type ValidationRule,
  type VersionDataRequirements,
} from './types';

/** Database row shapes for Phase 2 tables and their mapping to the domain model. */

export interface FieldDefinitionRow {
  id: string;
  project_id: string;
  ref_code: string;
  name: string;
  description: string;
  data_type: DataType;
  allowed_values: string[];
  default_value: string;
  source: FieldSource;
  source_detail: string;
  status: FieldStatus;
  origin: Origin;
  revision: number;
}

export interface ValidationRuleRow {
  id: string;
  project_id: string;
  field_id: string;
  ref_code: string;
  rule_type: RuleType;
  params: Partial<RuleParams> | null;
  statement: string;
  error_message: string;
  source_text: string | null;
  origin: Origin;
  status: RuleStatus;
  business_rule_id: string | null;
}

export interface BusinessRuleRow {
  id: string;
  project_id: string;
  ref_code: string;
  title: string;
  statement: string;
  category: BusinessRuleCategory;
  status: BusinessRuleStatus;
  origin: Origin;
  source_version_id: string | null;
  source_finding_key: string | null;
  revision: number;
}

export interface BusinessRuleActivityRow {
  business_rule_id: string;
  project_id: string;
  process_id: string;
  node_key: string;
}

export interface PhysicalColumnRow {
  id: string;
  project_id: string;
  system_name: string;
  table_name: string;
  column_name: string;
  data_type: string;
  notes: string;
}

export interface ActivityFieldRow {
  id: string;
  version_id: string;
  project_id: string;
  element_key: string;
  node_key: string;
  field_id: string;
  direction: IoDirection;
  mandatory: Mandatory;
  mandatory_condition: string;
  notes: string;
  origin: Origin;
  sort_order: number;
}

export interface ActivityOutputRow {
  id: string;
  version_id: string;
  project_id: string;
  element_key: string;
  node_key: string;
  kind: OutputKind;
  target: string;
  description: string;
  origin: Origin;
  sort_order: number;
}

export function fieldFromRow(row: FieldDefinitionRow): FieldDefinition {
  return {
    id: row.id,
    refCode: row.ref_code,
    name: row.name,
    description: row.description,
    dataType: row.data_type,
    allowedValues: row.allowed_values ?? [],
    defaultValue: row.default_value,
    source: row.source,
    sourceDetail: row.source_detail,
    status: row.status,
    origin: row.origin,
    revision: row.revision,
  };
}

export function ruleFromRow(row: ValidationRuleRow): ValidationRule {
  return {
    id: row.id,
    refCode: row.ref_code,
    fieldId: row.field_id,
    ruleType: row.rule_type,
    params: { ...EMPTY_RULE_PARAMS, ...(row.params ?? {}) },
    statement: row.statement,
    errorMessage: row.error_message,
    sourceText: row.source_text,
    origin: row.origin,
    status: row.status,
    businessRuleId: row.business_rule_id,
  };
}

export function businessRuleFromRow(row: BusinessRuleRow, links: BusinessRuleActivityRow[]): BusinessRule {
  return {
    id: row.id,
    refCode: row.ref_code,
    title: row.title,
    statement: row.statement,
    category: row.category,
    status: row.status,
    origin: row.origin,
    sourceFinding:
      row.source_version_id && row.source_finding_key
        ? { versionId: row.source_version_id, elementKey: row.source_finding_key }
        : null,
    activities: links.filter((l) => l.business_rule_id === row.id).map((l) => ({ processId: l.process_id, nodeKey: l.node_key })),
    revision: row.revision,
  };
}

export function columnFromRow(row: PhysicalColumnRow): PhysicalColumn {
  return {
    id: row.id,
    systemName: row.system_name,
    tableName: row.table_name,
    columnName: row.column_name,
    dataType: row.data_type,
    notes: row.notes,
  };
}

export function requirementsFromRows(fields: ActivityFieldRow[], outputs: ActivityOutputRow[]): VersionDataRequirements {
  return {
    fields: fields
      .map((r) => ({
        elementKey: r.element_key,
        nodeKey: r.node_key,
        fieldId: r.field_id,
        direction: r.direction,
        mandatory: r.mandatory,
        mandatoryCondition: r.mandatory_condition,
        notes: r.notes,
        origin: r.origin,
        sortOrder: r.sort_order,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
    outputs: outputs
      .map((r) => ({
        elementKey: r.element_key,
        nodeKey: r.node_key,
        kind: r.kind,
        target: r.target,
        description: r.description,
        origin: r.origin,
        sortOrder: r.sort_order,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

export interface SaveDataPayload {
  p_version_id: string;
  p_expected_revision: number;
  p_fields: {
    element_key: string;
    node_key: string;
    field_id: string;
    direction: IoDirection;
    mandatory: Mandatory;
    mandatory_condition: string;
    notes: string;
    origin: Origin;
    sort_order: number;
  }[];
  p_outputs: {
    element_key: string;
    node_key: string;
    kind: OutputKind;
    target: string;
    description: string;
    origin: Origin;
    sort_order: number;
  }[];
}

/** Arguments for `save_version_data`. Rows for activities not in `nodeKeys` are dropped. */
export function toSaveDataPayload(args: {
  versionId: string;
  expectedRevision: number;
  requirements: VersionDataRequirements;
  nodeKeys: Set<string>;
}): SaveDataPayload {
  const keep = <T extends { nodeKey: string }>(rows: T[]) => rows.filter((r) => args.nodeKeys.has(r.nodeKey));
  return {
    p_version_id: args.versionId,
    p_expected_revision: args.expectedRevision,
    p_fields: keep(args.requirements.fields).map((f: ActivityField, i) => ({
      element_key: f.elementKey,
      node_key: f.nodeKey,
      field_id: f.fieldId,
      direction: f.direction,
      mandatory: f.direction === 'output' ? 'no' : f.mandatory,
      mandatory_condition: f.direction === 'input' && f.mandatory === 'conditional' ? f.mandatoryCondition : '',
      notes: f.notes,
      origin: f.origin,
      sort_order: i,
    })),
    p_outputs: keep(args.requirements.outputs).map((o: ActivityOutput, i) => ({
      element_key: o.elementKey,
      node_key: o.nodeKey,
      kind: o.kind,
      target: o.target,
      description: o.description,
      origin: o.origin,
      sort_order: i,
    })),
  };
}
