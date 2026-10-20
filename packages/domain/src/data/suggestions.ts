import { newKey, normaliseName } from '../ids';
import type { ProcessGraph, ProcessNode } from '../process/types';
import type { FieldSuggestions, RuleTranslation, SuggestedField } from './ai-schema';
import type { FieldSuggestionContext } from './ai-prompt';
import type {
  ActivityField,
  ActivityOutput,
  DataType,
  FieldDefinition,
  FieldSource,
  IoDirection,
  Mandatory,
  OutputKind,
  RuleParams,
  RuleType,
  VersionDataRequirements,
} from './types';
import type { Actor, Origin } from '../process/types';
import type { BusinessRuleCategory } from './types';

/** Activities that can have inputs and outputs: everything except start and end events. */
export function dataActivities(graph: ProcessGraph): ProcessNode[] {
  return graph.nodes
    .filter((n) => n.type !== 'start' && n.type !== 'end')
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
}

/**
 * Builds the context for a field-suggestion request. Activities get short
 * ids (A1, A2, …) so the model never has to copy UUIDs; the returned map
 * translates them back to element keys.
 */
export function buildSuggestionContext(args: {
  processName: string;
  description: string;
  graph: ProcessGraph;
  actors: Actor[];
  dictionary: FieldDefinition[];
  businessRules: string[];
  /** Limit to these activities; all activities when omitted. */
  nodeKeys?: string[];
}): { context: FieldSuggestionContext; keyByActivityId: Map<string, string> } {
  const actorName = new Map(args.actors.map((a) => [a.id, a.name]));
  const wanted = args.nodeKeys ? new Set(args.nodeKeys) : null;
  const keyByActivityId = new Map<string, string>();
  const activities = dataActivities(args.graph)
    .filter((n) => !wanted || wanted.has(n.elementKey))
    .map((n, i) => {
      const id = `A${i + 1}`;
      keyByActivityId.set(id, n.elementKey);
      return {
        id,
        refCode: n.refCode,
        type: n.type,
        label: n.label,
        description: n.description,
        actor: n.actorId ? (actorName.get(n.actorId) ?? null) : null,
      };
    });
  return {
    context: {
      processName: args.processName,
      description: args.description,
      activities,
      dictionary: args.dictionary
        .filter((f) => f.status !== 'deprecated')
        .map((f) => ({ refCode: f.refCode, name: f.name, dataType: f.dataType, description: f.description })),
      businessRules: args.businessRules,
    },
    keyByActivityId,
  };
}

/** A field definition the proposal would create; `key` groups uses of the same new field. */
export interface NewFieldDraft {
  key: string;
  name: string;
  dataType: DataType;
  allowedValues: string[];
  description: string;
  source: FieldSource;
  sourceDetail: string;
  origin: Origin;
}

export interface FieldProposalItem {
  key: string;
  nodeKey: string;
  direction: IoDirection;
  /** Either an existing dictionary field or a new one. */
  existingFieldId: string | null;
  newFieldKey: string | null;
  mandatory: Mandatory;
  mandatoryCondition: string;
  origin: Origin;
  rationale: string;
  /** The activity already has this field in this direction. */
  alreadyMapped: boolean;
}

export interface OutputProposalItem {
  key: string;
  nodeKey: string;
  kind: OutputKind;
  target: string;
  description: string;
  origin: Origin;
}

export interface DataProposal {
  newFields: NewFieldDraft[];
  fields: FieldProposalItem[];
  outputs: OutputProposalItem[];
  questions: string[];
}

/**
 * Turns Claude's suggestions into a reviewable proposal. Existing dictionary
 * fields are reused by ref code or, failing that, by name; new fields with
 * the same name are proposed once and shared between activities.
 */
export function suggestionsToProposal(
  suggestions: FieldSuggestions,
  args: { keyByActivityId: Map<string, string>; dictionary: FieldDefinition[]; current: VersionDataRequirements },
): DataProposal {
  const byRef = new Map(args.dictionary.map((f) => [f.refCode.toUpperCase(), f]));
  const byName = new Map(args.dictionary.filter((f) => f.status !== 'deprecated').map((f) => [normaliseName(f.name), f]));
  const mapped = new Set(args.current.fields.map((f) => `${f.nodeKey}|${f.direction}|${f.fieldId}`));
  const newFields = new Map<string, NewFieldDraft>();
  const fields: FieldProposalItem[] = [];
  const outputs: OutputProposalItem[] = [];

  const resolve = (s: SuggestedField): { existing: FieldDefinition | null; draft: NewFieldDraft | null } => {
    const existing =
      (s.existingFieldRef && byRef.get(s.existingFieldRef.toUpperCase())) || byName.get(normaliseName(s.name)) || null;
    if (existing) return { existing, draft: null };
    const name = s.name.trim();
    const norm = normaliseName(name);
    let draft = newFields.get(norm);
    if (!draft) {
      draft = {
        key: newKey(),
        name,
        dataType: s.dataType,
        allowedValues: s.dataType === 'enum' ? s.allowedValues.map((v) => v.trim()).filter(Boolean) : [],
        description: s.description.trim(),
        source: s.source,
        sourceDetail: s.sourceDetail.trim(),
        origin: s.origin,
      };
      newFields.set(norm, draft);
    }
    return { existing: null, draft };
  };

  for (const activity of suggestions.activities) {
    const nodeKey = args.keyByActivityId.get(activity.activityId);
    if (!nodeKey) continue;
    const seen = new Set<string>();
    const add = (s: SuggestedField, direction: IoDirection) => {
      if (!s.name.trim()) return;
      const { existing, draft } = resolve(s);
      const identity = `${direction}|${existing?.id ?? draft!.key}`;
      if (seen.has(identity)) return;
      seen.add(identity);
      fields.push({
        key: newKey(),
        nodeKey,
        direction,
        existingFieldId: existing?.id ?? null,
        newFieldKey: draft?.key ?? null,
        mandatory: direction === 'output' ? 'no' : s.mandatory,
        mandatoryCondition: direction === 'input' && s.mandatory === 'conditional' ? s.mandatoryCondition.trim() : '',
        origin: s.origin,
        rationale: s.rationale.trim(),
        alreadyMapped: existing ? mapped.has(`${nodeKey}|${direction}|${existing.id}`) : false,
      });
    };
    activity.inputs.forEach((s) => add(s, 'input'));
    activity.outputFields.forEach((s) => add(s, 'output'));
    for (const o of activity.otherOutputs) {
      if (!o.target.trim() && !o.description.trim()) continue;
      outputs.push({
        key: newKey(),
        nodeKey,
        kind: o.kind,
        target: o.target.trim(),
        description: o.description.trim(),
        origin: o.origin,
      });
    }
  }

  return { newFields: [...newFields.values()], fields, outputs, questions: suggestions.questions };
}

/**
 * Adds the accepted proposal items to the requirements. `fieldIdByNewKey`
 * maps each new field draft to the dictionary id it was created with.
 * Items already mapped are skipped, so accepting twice changes nothing.
 */
export function applyDataProposal(
  current: VersionDataRequirements,
  args: {
    fields: FieldProposalItem[];
    outputs: OutputProposalItem[];
    fieldIdByNewKey: Map<string, string>;
  },
): VersionDataRequirements {
  const existing = new Set(current.fields.map((f) => `${f.nodeKey}|${f.direction}|${f.fieldId}`));
  const fields: ActivityField[] = [...current.fields];
  const nextOrder = (nodeKey: string, list: { nodeKey: string; sortOrder: number }[]) =>
    list.filter((x) => x.nodeKey === nodeKey).reduce((max, x) => Math.max(max, x.sortOrder + 1), 0);

  for (const item of args.fields) {
    const fieldId = item.existingFieldId ?? (item.newFieldKey ? args.fieldIdByNewKey.get(item.newFieldKey) : undefined);
    if (!fieldId) continue;
    const identity = `${item.nodeKey}|${item.direction}|${fieldId}`;
    if (existing.has(identity)) continue;
    existing.add(identity);
    fields.push({
      elementKey: newKey(),
      nodeKey: item.nodeKey,
      fieldId,
      direction: item.direction,
      mandatory: item.mandatory,
      mandatoryCondition: item.mandatoryCondition,
      notes: '',
      origin: item.origin,
      sortOrder: nextOrder(item.nodeKey, fields),
    });
  }
  const outputs: ActivityOutput[] = [...current.outputs];
  for (const item of args.outputs) {
    outputs.push({
      elementKey: newKey(),
      nodeKey: item.nodeKey,
      kind: item.kind,
      target: item.target,
      description: item.description,
      origin: item.origin,
      sortOrder: nextOrder(item.nodeKey, outputs),
    });
  }
  return { fields, outputs };
}

/** A structured validation rule proposed from natural language, not yet stored. */
export interface RuleDraft {
  key: string;
  ruleType: RuleType;
  params: RuleParams;
  statement: string;
  errorMessage: string;
}

export interface BusinessRuleDraft {
  key: string;
  title: string;
  statement: string;
  category: BusinessRuleCategory;
}

export interface RuleTranslationProposal {
  rules: RuleDraft[];
  businessRules: BusinessRuleDraft[];
  questions: string[];
}

export function translationToProposal(translation: RuleTranslation, dictionary: FieldDefinition[]): RuleTranslationProposal {
  const byRef = new Map(dictionary.map((f) => [f.refCode.toUpperCase(), f.id]));
  return {
    rules: translation.rules.map((r) => ({
      key: newKey(),
      ruleType: r.ruleType,
      statement: r.statement.trim(),
      errorMessage: r.errorMessage.trim(),
      params: {
        min: r.min,
        max: r.max,
        exclusive: r.exclusive,
        minLength: r.minLength === null ? null : Math.round(r.minLength),
        maxLength: r.maxLength === null ? null : Math.round(r.maxLength),
        pattern: r.pattern?.trim() || null,
        condition: r.condition?.trim() || null,
        otherFieldId: r.otherFieldRef ? (byRef.get(r.otherFieldRef.toUpperCase()) ?? null) : null,
        lookupSource: r.lookupSource?.trim() || null,
      },
    })),
    businessRules: translation.businessRules.map((b) => ({
      key: newKey(),
      title: b.title.trim(),
      statement: b.statement.trim(),
      category: b.category,
    })),
    questions: translation.questions,
  };
}
