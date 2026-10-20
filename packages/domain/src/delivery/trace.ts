import type { ActivityFieldRow } from '../data/persistence';
import type { BusinessRule, FieldColumnMapping, FieldDefinition, PhysicalColumn, ValidationRule } from '../data/types';
import type { ProcessEdgeRow, ProcessNodeRow, ProcessRow, ProcessVersionRow } from '../process/persistence';
import { findVagueTerms } from '../process/validation';
import type { ProjectRole } from '../roles';
import { newestExecutionFirst, scenarioReadiness, scenarioUatStatus, type UatStatus } from './workflow';
import type { ActivityRef, BusinessScenario, Defect, DeliverySnapshot, Story, TestExecution } from './types';

/**
 * What delivery needs to know about the rest of the project: processes and
 * their versions, the data dictionary and the rule registers. Loaded by the
 * delivery store from the Phase 1 and 2 tables.
 */
export interface ProjectContext {
  projectId: string;
  projectKey: string;
  processes: ProcessRow[];
  versions: ProcessVersionRow[];
  nodes: ProcessNodeRow[];
  edges: ProcessEdgeRow[];
  actors: { id: string; name: string }[];
  activityFields: ActivityFieldRow[];
  fields: FieldDefinition[];
  validationRules: ValidationRule[];
  businessRules: BusinessRule[];
  columns: PhysicalColumn[];
  columnMappings: FieldColumnMapping[];
  members: { userId: string; displayName: string; role: ProjectRole }[];
}

export const activityKey = (ref: ActivityRef) => `${ref.processId}|${ref.nodeKey}`;
const WORK_NODE_TYPES = new Set(['activity', 'approval', 'system', 'decision']);

export interface ActivityInfo extends ActivityRef {
  processRef: string;
  processName: string;
  /** The version the details come from: the open draft if there is one, otherwise the latest approved version. */
  versionId: string;
  versionNumber: number;
  versionStatus: ProcessVersionRow['status'];
  refCode: string | null;
  label: string;
  nodeType: ProcessNodeRow['node_type'];
}

/** The version of a process whose activities delivery works from: the open draft, else the newest approved. */
export function currentVersion(ctx: Pick<ProjectContext, 'versions'>, processId: string): ProcessVersionRow | null {
  const versions = ctx.versions.filter((v) => v.process_id === processId).sort((a, b) => b.version_number - a.version_number);
  return versions.find((v) => v.status === 'draft') ?? versions.find((v) => v.status === 'approved') ?? versions[0] ?? null;
}

/** The latest approved version of a process, or null. */
export function approvedVersion(ctx: Pick<ProjectContext, 'versions'>, processId: string): ProcessVersionRow | null {
  return ctx.versions.find((v) => v.process_id === processId && v.status === 'approved') ?? null;
}

/** Every work step (not start or end events) of every process, from each process's current version. */
export function activityIndex(ctx: ProjectContext): Map<string, ActivityInfo> {
  const index = new Map<string, ActivityInfo>();
  for (const process of ctx.processes) {
    const version = currentVersion(ctx, process.id);
    if (!version) continue;
    for (const node of ctx.nodes) {
      if (node.version_id !== version.id || !WORK_NODE_TYPES.has(node.node_type)) continue;
      index.set(activityKey({ processId: process.id, nodeKey: node.element_key }), {
        processId: process.id,
        nodeKey: node.element_key,
        processRef: process.ref_code,
        processName: process.name,
        versionId: version.id,
        versionNumber: version.version_number,
        versionStatus: version.status,
        refCode: node.ref_code,
        label: node.label,
        nodeType: node.node_type,
      });
    }
  }
  return index;
}

/** Technical stories that implement any of the given functional stories. */
export function implementingStories(stories: Story[], functionalIds: Set<string>): Story[] {
  return stories.filter((s) => s.storyType === 'technical' && s.implementsIds.some((id) => functionalIds.has(id)));
}

export interface ActivityTrace {
  activity: ActivityInfo;
  inputs: { field: FieldDefinition; mandatory: string; condition: string }[];
  outputs: FieldDefinition[];
  validationRules: ValidationRule[];
  businessRules: BusinessRule[];
  functionalStories: Story[];
  technicalStories: Story[];
  scenarios: { scenario: BusinessScenario; uat: UatStatus; lastExecution: TestExecution | null }[];
  openDefects: Defect[];
}

/** Everything linked to one activity: its data, rules, stories, development status, scenarios, UAT results and open defects. */
export function traceActivity(ctx: ProjectContext, snapshot: DeliverySnapshot, ref: ActivityRef): ActivityTrace | null {
  const activity = activityIndex(ctx).get(activityKey(ref));
  if (!activity) return null;
  const fieldsById = new Map(ctx.fields.map((f) => [f.id, f]));
  const uses = ctx.activityFields.filter((f) => f.version_id === activity.versionId && f.node_key === ref.nodeKey);
  const fieldIds = new Set(uses.map((u) => u.field_id));
  const key = activityKey(ref);
  const functional = snapshot.stories.filter(
    (s) => s.storyType === 'functional' && s.activities.some((a) => activityKey(a) === key),
  );
  const technical = [
    ...new Map(
      [
        ...implementingStories(snapshot.stories, new Set(functional.map((s) => s.id))),
        ...snapshot.stories.filter((s) => s.storyType === 'technical' && s.activities.some((a) => activityKey(a) === key)),
      ].map((s) => [s.id, s]),
    ).values(),
  ];
  const storyIds = new Set([...functional, ...technical].map((s) => s.id));
  const storiesById = new Map(snapshot.stories.map((s) => [s.id, s]));
  const scenarios = snapshot.scenarios.filter(
    (sc) => sc.activities.some((a) => activityKey(a) === key) || sc.storyIds.some((id) => storyIds.has(id)),
  );
  const scenarioIds = new Set(scenarios.map((s) => s.id));
  return {
    activity,
    inputs: uses
      .filter((u) => u.direction === 'input' && fieldsById.has(u.field_id))
      .map((u) => ({ field: fieldsById.get(u.field_id)!, mandatory: u.mandatory, condition: u.mandatory_condition })),
    outputs: uses.filter((u) => u.direction === 'output' && fieldsById.has(u.field_id)).map((u) => fieldsById.get(u.field_id)!),
    validationRules: ctx.validationRules.filter((r) => fieldIds.has(r.fieldId)),
    businessRules: ctx.businessRules.filter((b) =>
      b.activities.some((a) => a.processId === ref.processId && a.nodeKey === ref.nodeKey),
    ),
    functionalStories: functional,
    technicalStories: technical,
    scenarios: scenarios.map((scenario) => {
      const runs = snapshot.executions
        .filter((e) => e.scenarioId === scenario.id && e.status !== 'in_progress')
        .sort(newestExecutionFirst);
      return {
        scenario,
        uat: scenarioUatStatus(scenario, snapshot.executions, scenarioReadiness(scenario, storiesById)),
        lastExecution: runs[0] ?? null,
      };
    }),
    openDefects: snapshot.defects.filter(
      (d) =>
        d.status !== 'closed' && ((d.scenarioId && scenarioIds.has(d.scenarioId)) || d.storyIds.some((id) => storyIds.has(id))),
    ),
  };
}

// ---------------------------------------------------------------------------
// Requirement consistency checks
// ---------------------------------------------------------------------------

export interface ConsistencyIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category: 'coverage' | 'links' | 'quality' | 'planning';
  message: string;
  /** Ref codes of the records involved. */
  subjects: string[];
}

/**
 * Automated checks across requirements: coverage of approved activities by
 * stories and scenarios, broken or inconsistent links, untestable wording and
 * planning gaps. Deterministic, so the same data always gives the same result.
 */
export function consistencyChecks(ctx: ProjectContext, snapshot: DeliverySnapshot): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const add = (issue: Omit<ConsistencyIssue, 'id'>) => issues.push({ ...issue, id: `${issue.category}:${issues.length}` });
  const index = activityIndex(ctx);
  const stories = snapshot.stories;
  const functional = stories.filter((s) => s.storyType === 'functional');
  const fieldsById = new Map(ctx.fields.map((f) => [f.id, f]));
  const storyById = new Map(stories.map((s) => [s.id, s]));
  const linkedKeys = new Set(stories.flatMap((s) => s.activities.map(activityKey)));

  // Coverage: every activity of an approved process should be covered by a functional story.
  for (const info of index.values()) {
    if (info.nodeType === 'decision') continue;
    if (!approvedVersion(ctx, info.processId)) continue;
    if (!linkedKeys.has(activityKey(info))) {
      add({
        severity: 'warning',
        category: 'coverage',
        message: `${info.refCode ?? 'Activity'} "${info.label}" in ${info.processRef} has no user story.`,
        subjects: [info.refCode ?? info.label],
      });
    }
  }
  for (const s of functional) {
    if (s.status === 'draft') continue;
    if (implementingStories(stories, new Set([s.id])).length === 0) {
      add({
        severity: 'warning',
        category: 'coverage',
        message: `${s.refCode} has no technical story implementing it.`,
        subjects: [s.refCode],
      });
    }
    const tested = snapshot.scenarios.some(
      (sc) =>
        sc.storyIds.some((id) => id === s.id || storyById.get(id)?.implementsIds.includes(s.id)) ||
        sc.activities.some((a) => s.activities.some((b) => activityKey(a) === activityKey(b))),
    );
    if (!tested) {
      add({
        severity: 'info',
        category: 'coverage',
        message: `${s.refCode} is not covered by any business test scenario.`,
        subjects: [s.refCode],
      });
    }
  }
  const linkedRules = new Set(stories.flatMap((s) => s.businessRuleIds));
  for (const rule of ctx.businessRules) {
    if (rule.status === 'approved' && !linkedRules.has(rule.id)) {
      add({
        severity: 'warning',
        category: 'coverage',
        message: `Approved business rule ${rule.refCode} "${rule.title}" is not referenced by any story.`,
        subjects: [rule.refCode],
      });
    }
  }

  // Links
  for (const s of stories) {
    for (const a of s.activities) {
      if (!index.has(activityKey(a))) {
        add({
          severity: 'error',
          category: 'links',
          message: `${s.refCode} is linked to an activity that is no longer in the process map.`,
          subjects: [s.refCode],
        });
      }
    }
    const activityFieldIds = new Set(
      s.activities.flatMap((a) => {
        const info = index.get(activityKey(a));
        return info
          ? ctx.activityFields.filter((f) => f.version_id === info.versionId && f.node_key === a.nodeKey).map((f) => f.field_id)
          : [];
      }),
    );
    for (const id of s.fieldIds) {
      const field = fieldsById.get(id);
      if (!field) {
        add({
          severity: 'error',
          category: 'links',
          message: `${s.refCode} refers to a field that was deleted.`,
          subjects: [s.refCode],
        });
      } else if (field.status === 'deprecated') {
        add({
          severity: 'warning',
          category: 'links',
          message: `${s.refCode} uses deprecated field ${field.refCode} ${field.name}.`,
          subjects: [s.refCode, field.refCode],
        });
      } else if (s.storyType === 'functional' && s.activities.length > 0 && !activityFieldIds.has(id)) {
        add({
          severity: 'info',
          category: 'links',
          message: `${s.refCode} uses ${field.refCode} ${field.name}, which its activities do not list as an input or output.`,
          subjects: [s.refCode, field.refCode],
        });
      }
    }
    if (s.storyType === 'technical' && s.implementsIds.length === 0) {
      add({
        severity: 'info',
        category: 'links',
        message: `${s.refCode} does not implement any functional story.`,
        subjects: [s.refCode],
      });
    }
    for (const id of s.dependsOnIds) {
      const dep = storyById.get(id);
      if (
        dep &&
        dep.backlogRank > s.backlogRank &&
        s.status === 'in_backlog' &&
        dep.status === 'in_backlog' &&
        dep.workStatus !== 'completed'
      ) {
        add({
          severity: 'info',
          category: 'planning',
          message: `${s.refCode} is ranked above ${dep.refCode}, which it depends on.`,
          subjects: [s.refCode, dep.refCode],
        });
      }
    }
  }
  for (const sc of snapshot.scenarios) {
    if (sc.storyIds.length === 0) {
      add({
        severity: 'warning',
        category: 'links',
        message: `${sc.refCode} is not linked to any technical story, so it can never become ready for UAT.`,
        subjects: [sc.refCode],
      });
    }
  }

  // Quality: testable wording.
  for (const s of stories) {
    if (s.acceptanceCriteria.length === 0) {
      add({
        severity: 'warning',
        category: 'quality',
        message: `${s.refCode} has no acceptance criteria.`,
        subjects: [s.refCode],
      });
    }
    const vague = findVagueTerms(s.acceptanceCriteria.map((c) => c.text).join(' '));
    if (vague.length) {
      add({
        severity: 'warning',
        category: 'quality',
        message: `${s.refCode} acceptance criteria use vague wording (${vague.map((v) => `"${v}"`).join(', ')}).`,
        subjects: [s.refCode],
      });
    }
    if (s.storyType === 'technical' && s.status !== 'draft' && s.errorScenarios.length === 0) {
      add({ severity: 'info', category: 'quality', message: `${s.refCode} lists no error scenarios.`, subjects: [s.refCode] });
    }
  }

  // Planning
  const inSprint = new Set(snapshot.sprintItems.filter((i) => i.removedAt === null).map((i) => i.storyId));
  for (const s of stories) {
    if (inSprint.has(s.id) && (s.estimateHours === null || s.storyPoints === null)) {
      add({
        severity: 'warning',
        category: 'planning',
        message: `${s.refCode} is in a sprint without ${s.estimateHours === null ? 'an hours estimate' : 'story points'}.`,
        subjects: [s.refCode],
      });
    }
    if (s.reviewFlag) {
      add({
        severity: 'warning',
        category: 'planning',
        message: `${s.refCode} needs review after a process change: ${s.reviewFlag}`,
        subjects: [s.refCode],
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Change impact
// ---------------------------------------------------------------------------

export interface ProcessChange {
  kind: 'added' | 'removed' | 'changed';
  element: 'activity' | 'decision_branch' | 'field' | 'validation_rule';
  /** Ref code or name of the element. */
  ref: string;
  nodeKey: string | null;
  description: string;
}

export interface ImpactedItem {
  id: string;
  refCode: string;
  type: 'functional_story' | 'technical_story' | 'scenario';
  title: string;
  status: string;
  reasons: string[];
}

export interface ChangeImpact {
  changes: ProcessChange[];
  affectedActivities: string[];
  affectedFieldIds: string[];
  items: ImpactedItem[];
}

/**
 * Compares two versions of a process and finds the delivery records affected:
 * activities added, removed or reworded, decision branches changed, fields
 * added or removed from activities, and validation rules on those fields.
 * Stories and scenarios linked to any of them are reported, with the reasons.
 */
export function analyseChangeImpact(
  ctx: ProjectContext,
  snapshot: DeliverySnapshot,
  processId: string,
  fromVersionId: string,
  toVersionId: string,
): ChangeImpact {
  const nodesOf = (v: string) => new Map(ctx.nodes.filter((n) => n.version_id === v).map((n) => [n.element_key, n]));
  const edgesOf = (v: string) => ctx.edges.filter((e) => e.version_id === v);
  const fieldsOf = (v: string) =>
    new Map(ctx.activityFields.filter((f) => f.version_id === v).map((f) => [`${f.node_key}|${f.direction}|${f.field_id}`, f]));
  const before = nodesOf(fromVersionId);
  const after = nodesOf(toVersionId);
  const fieldName = (id: string) => {
    const f = ctx.fields.find((x) => x.id === id);
    return f ? `${f.refCode} ${f.name}` : 'a field';
  };
  const nodeName = (n: ProcessNodeRow) => `${n.ref_code ?? ''} "${n.label}"`.trim();
  const changes: ProcessChange[] = [];
  const changedKeys = new Set<string>();
  const changedFields = new Set<string>();

  for (const [key, node] of after) {
    const old = before.get(key);
    if (!old) {
      changes.push({
        kind: 'added',
        element: 'activity',
        ref: nodeName(node),
        nodeKey: key,
        description: `Added ${node.node_type} ${nodeName(node)}`,
      });
      changedKeys.add(key);
    } else {
      const diffs: string[] = [];
      if (old.label !== node.label) diffs.push(`renamed from "${old.label}"`);
      if (old.node_type !== node.node_type) diffs.push(`type changed from ${old.node_type} to ${node.node_type}`);
      if (old.actor_id !== node.actor_id) diffs.push('responsible actor changed');
      if (old.description !== node.description) diffs.push('description changed');
      if (diffs.length) {
        changes.push({
          kind: 'changed',
          element: 'activity',
          ref: nodeName(node),
          nodeKey: key,
          description: `${nodeName(node)}: ${diffs.join(', ')}`,
        });
        changedKeys.add(key);
      }
    }
  }
  for (const [key, node] of before) {
    if (!after.has(key)) {
      changes.push({
        kind: 'removed',
        element: 'activity',
        ref: nodeName(node),
        nodeKey: key,
        description: `Removed ${node.node_type} ${nodeName(node)}`,
      });
      changedKeys.add(key);
    }
  }
  // Decision branches: connections leaving a decision or approval.
  const branchSig = (e: ProcessEdgeRow) => `${e.target_key}|${e.branch ?? ''}|${e.condition}|${e.label}`;
  for (const [key, node] of after) {
    if (node.node_type !== 'decision' && node.node_type !== 'approval') continue;
    const oldSigs = edgesOf(fromVersionId)
      .filter((e) => e.source_key === key)
      .map(branchSig)
      .sort();
    const newSigs = edgesOf(toVersionId)
      .filter((e) => e.source_key === key)
      .map(branchSig)
      .sort();
    if (before.has(key) && oldSigs.join('\n') !== newSigs.join('\n')) {
      changes.push({
        kind: 'changed',
        element: 'decision_branch',
        ref: nodeName(node),
        nodeKey: key,
        description: `Outcomes of ${nodeName(node)} changed`,
      });
      changedKeys.add(key);
    }
  }
  // Fields used by activities.
  const oldFields = fieldsOf(fromVersionId);
  const newFields = fieldsOf(toVersionId);
  for (const [k, f] of newFields) {
    const old = oldFields.get(k);
    const node = after.get(f.node_key);
    const where = node ? ` on ${nodeName(node)}` : '';
    if (!old) {
      changes.push({
        kind: 'added',
        element: 'field',
        ref: fieldName(f.field_id),
        nodeKey: f.node_key,
        description: `${f.direction === 'input' ? 'Input' : 'Output'} ${fieldName(f.field_id)} added${where}`,
      });
    } else if (old.mandatory !== f.mandatory || old.mandatory_condition !== f.mandatory_condition) {
      changes.push({
        kind: 'changed',
        element: 'field',
        ref: fieldName(f.field_id),
        nodeKey: f.node_key,
        description: `${fieldName(f.field_id)}${where} is now ${f.mandatory === 'conditional' ? `required when ${f.mandatory_condition}` : f.mandatory === 'yes' ? 'mandatory' : 'optional'}`,
      });
    } else continue;
    changedKeys.add(f.node_key);
    changedFields.add(f.field_id);
  }
  for (const [k, f] of oldFields) {
    if (newFields.has(k)) continue;
    const node = before.get(f.node_key);
    changes.push({
      kind: 'removed',
      element: 'field',
      ref: fieldName(f.field_id),
      nodeKey: f.node_key,
      description: `${fieldName(f.field_id)} removed${node ? ` from ${nodeName(node)}` : ''}`,
    });
    changedKeys.add(f.node_key);
    changedFields.add(f.field_id);
  }
  for (const rule of ctx.validationRules) {
    if (changedFields.has(rule.fieldId)) {
      changes.push({
        kind: 'changed',
        element: 'validation_rule',
        ref: rule.refCode,
        nodeKey: null,
        description: `${rule.refCode} validates ${fieldName(rule.fieldId)}, whose use changed`,
      });
    }
  }

  const items = new Map<string, ImpactedItem>();
  const flag = (record: Story | BusinessScenario, type: ImpactedItem['type'], reason: string) => {
    const item = items.get(record.id) ?? {
      id: record.id,
      refCode: record.refCode,
      type,
      title: record.title,
      status: record.status,
      reasons: [],
    };
    if (!item.reasons.includes(reason)) item.reasons.push(reason);
    items.set(record.id, item);
  };
  const nodeLabel = (key: string) => {
    const n = after.get(key) ?? before.get(key);
    return n ? nodeName(n) : 'an activity';
  };
  for (const s of snapshot.stories) {
    const type = s.storyType === 'functional' ? 'functional_story' : 'technical_story';
    for (const a of s.activities) {
      if (a.processId === processId && changedKeys.has(a.nodeKey))
        flag(s, type, `Linked to ${nodeLabel(a.nodeKey)}, which changed`);
    }
    for (const f of s.fieldIds) if (changedFields.has(f)) flag(s, type, `Uses ${fieldName(f)}, whose use changed`);
  }
  for (const t of snapshot.stories.filter((s) => s.storyType === 'technical')) {
    for (const id of t.implementsIds) {
      const parent = items.get(id);
      if (parent) flag(t, 'technical_story', `Implements ${parent.refCode}, which is affected`);
    }
  }
  for (const sc of snapshot.scenarios) {
    for (const a of sc.activities) {
      if (a.processId === processId && changedKeys.has(a.nodeKey))
        flag(sc, 'scenario', `Tests ${nodeLabel(a.nodeKey)}, which changed`);
    }
    for (const id of sc.storyIds) {
      const story = items.get(id);
      if (story) flag(sc, 'scenario', `Depends on ${story.refCode}, which is affected`);
    }
  }
  return {
    changes,
    affectedActivities: [...changedKeys].map(nodeLabel),
    affectedFieldIds: [...changedFields],
    items: [...items.values()],
  };
}
