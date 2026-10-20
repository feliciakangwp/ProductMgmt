import type { ActivityFieldRow } from '../data/persistence';
import { EMPTY_RULE_PARAMS } from '../data/types';
import type { ProcessEdgeRow, ProcessNodeRow, ProcessVersionRow } from '../process/persistence';
import type { ProjectRole } from '../roles';
import { DomainError, type AiGateway, type OpContext } from '../delivery/service';
import { createMemoryDeliveryStore, emptyDeliveryTables } from '../delivery/memory-store';
import type { ProjectContext } from '../delivery/trace';
import { deliveryAnswerFor } from './delivery-fixtures';

/**
 * An in-memory project for testing the delivery service: a debt write-off
 * process with an approved version, a few dictionary fields and rules, and
 * one member per role.
 */

export const USERS = {
  admin: 'u-admin',
  po: 'u-po',
  ba: 'u-ba',
  dev: 'u-dev',
  bu: 'u-bu',
  outsider: 'u-outsider',
} as const;

const ROLES: Record<string, ProjectRole> = {
  [USERS.admin]: 'admin',
  [USERS.po]: 'product_owner',
  [USERS.ba]: 'business_analyst',
  [USERS.dev]: 'developer',
  [USERS.bu]: 'business_user',
};

/** AI gateway answering with the fixture for the task, validated by the task's own parser. */
export function fixtureAiGateway(): AiGateway & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(task, input) {
      calls.push(task.name);
      const schema = task.schema() as { properties?: Record<string, unknown> };
      const answer = deliveryAnswerFor(schema.properties ?? {}, task.user(input));
      const parsed = task.parse(JSON.stringify(answer), input);
      if (!parsed.ok) throw new DomainError(`Fixture failed validation: ${parsed.errors.join('; ')}`, 'ai_invalid_output');
      return { value: parsed.value, model: 'fixture', runId: `run-${calls.length}` };
    },
  };
}

export function createDeliveryHarness(start = '2026-11-02T09:00:00.000Z') {
  const projectId = 'p-1';
  const processId = 'proc-1';
  const tables = emptyDeliveryTables();
  let clock = Date.parse(start);
  let seq = 0;
  const counters: Record<string, number> = {};
  const node = (versionId: string, key: string, ref: string, type: ProcessNodeRow['node_type'], label: string): ProcessNodeRow => ({
    id: `${versionId}-${key}`,
    version_id: versionId,
    project_id: projectId,
    element_key: key,
    ref_code: ref,
    node_type: type,
    label,
    description: '',
    actor_id: type === 'system' ? null : 'actor-officer',
    position_x: 0,
    position_y: 0,
    origin: 'stated',
    source_text: null,
  });
  const version = (id: string, n: number, status: ProcessVersionRow['status']): ProcessVersionRow => ({
    id,
    process_id: processId,
    project_id: projectId,
    version_number: n,
    status,
    description: 'Finance Officer submits a write-off request; the supervisor reviews it.',
    revision: 1,
    data_revision: 1,
    based_on_version_id: null,
    created_by: USERS.ba,
    created_at: start,
    updated_at: start,
    updated_by: USERS.ba,
    approved_by: status === 'approved' ? USERS.po : null,
    approved_at: status === 'approved' ? start : null,
  });
  const edge = (versionId: string, from: string, to: string, branch: ProcessEdgeRow['branch'] = null): ProcessEdgeRow => ({
    id: `${versionId}-${from}-${to}`,
    version_id: versionId,
    project_id: projectId,
    element_key: `${from}-${to}`,
    source_key: from,
    target_key: to,
    label: '',
    condition: '',
    branch,
  });
  const use = (versionId: string, nodeKey: string, fieldId: string, direction: 'input' | 'output', mandatory: ActivityFieldRow['mandatory'] = 'yes'): ActivityFieldRow => ({
    id: `${versionId}-${nodeKey}-${fieldId}`,
    version_id: versionId,
    project_id: projectId,
    element_key: `${nodeKey}-${fieldId}`,
    node_key: nodeKey,
    field_id: fieldId,
    direction,
    mandatory: direction === 'output' ? 'no' : mandatory,
    mandatory_condition: '',
    notes: '',
    origin: 'stated',
    sort_order: 0,
  });

  const v1 = 'ver-1';
  const context: ProjectContext = {
    projectId,
    projectKey: 'DMM',
    processes: [
      { id: processId, project_id: projectId, ref_code: 'PRC-001', name: 'Debt write-off', process_type: 'to_be', owner: '', business_unit: '', created_by: USERS.ba, created_at: start, updated_at: start },
    ],
    versions: [version(v1, 1, 'approved')],
    nodes: [
      node(v1, 'k-start', 'EVT-001', 'start', 'Request received'),
      node(v1, 'k-submit', 'ACT-001', 'activity', 'Submit write-off request'),
      node(v1, 'k-review', 'ACT-002', 'approval', 'Review write-off request'),
      node(v1, 'k-update', 'ACT-003', 'system', 'Update debt status'),
      node(v1, 'k-end', 'EVT-002', 'end', 'Debt written off'),
    ],
    edges: [edge(v1, 'k-start', 'k-submit'), edge(v1, 'k-submit', 'k-review'), edge(v1, 'k-review', 'k-update', 'yes'), edge(v1, 'k-review', 'k-submit', 'no'), edge(v1, 'k-update', 'k-end')],
    actors: [{ id: 'actor-officer', name: 'Finance Officer' }],
    activityFields: [use(v1, 'k-submit', 'f-debt', 'input'), use(v1, 'k-submit', 'f-amount', 'input'), use(v1, 'k-update', 'f-status', 'output')],
    fields: [
      { id: 'f-debt', refCode: 'FLD-001', name: 'Debt ID', description: '', dataType: 'reference', allowedValues: [], defaultValue: '', source: 'retrieved', sourceDetail: '', status: 'approved', origin: 'stated', revision: 1 },
      { id: 'f-amount', refCode: 'FLD-002', name: 'Outstanding Amount', description: '', dataType: 'currency', allowedValues: [], defaultValue: '', source: 'retrieved', sourceDetail: '', status: 'approved', origin: 'stated', revision: 1 },
      { id: 'f-status', refCode: 'FLD-003', name: 'Debt Status', description: '', dataType: 'enum', allowedValues: ['Open', 'Written Off'], defaultValue: '', source: 'system_generated', sourceDetail: '', status: 'approved', origin: 'stated', revision: 1 },
    ],
    validationRules: [
      { id: 'vr-1', refCode: 'VR-001', fieldId: 'f-amount', ruleType: 'range', params: { ...EMPTY_RULE_PARAMS, min: 0, exclusive: true }, statement: 'Outstanding amount must be greater than zero.', errorMessage: '', sourceText: null, origin: 'manual', status: 'confirmed', businessRuleId: null },
    ],
    businessRules: [
      { id: 'br-1', refCode: 'BR-001', title: 'Director approval', statement: 'Write-off requests above $10,000 require Director approval during review.', category: 'approval', status: 'approved', origin: 'manual', sourceFinding: null, activities: [{ processId, nodeKey: 'k-review' }], revision: 1 },
    ],
    columns: [{ id: 'col-1', systemName: 'Debt DB', tableName: 'debts', columnName: 'principal_cents', dataType: 'bigint', notes: '' }],
    columnMappings: [{ fieldId: 'f-amount', columnId: 'col-1', transformation: '' }],
    members: Object.entries(ROLES).map(([userId, role]) => ({ userId, displayName: userId, role })),
  };

  const store = createMemoryDeliveryStore({
    tables: () => tables,
    memberRole: (p, u) => (p === projectId ? (ROLES[u] ?? null) : null),
    context: () => context,
    nextRef: (p, prefix) => {
      const key = `${p}:${prefix}`;
      counters[key] = (counters[key] ?? 0) + 1;
      return `${prefix}-${String(counters[key]).padStart(3, '0')}`;
    },
    processProject: (id) => (context.processes.some((p) => p.id === id) ? projectId : null),
  });
  const ai = fixtureAiGateway();

  return {
    projectId,
    processId,
    tables,
    context,
    store,
    ai,
    ctx(userId: string): OpContext {
      return { store, userId, ai, now: () => new Date(clock).toISOString(), newId: () => `id-${++seq}` };
    },
    /** Moves the clock forward. */
    advance(hours: number) {
      clock += hours * 3600 * 1000;
    },
    now: () => new Date(clock).toISOString(),
    /** Adds an open draft v2 in which the submit activity is renamed and a field is removed. */
    addChangedDraft() {
      const v2 = 'ver-2';
      context.versions.push(version(v2, 2, 'draft'));
      for (const n of context.nodes.filter((x) => x.version_id === v1)) {
        context.nodes.push({ ...n, id: `${v2}-${n.element_key}`, version_id: v2, label: n.element_key === 'k-submit' ? 'Lodge write-off request' : n.label });
      }
      for (const e of context.edges.filter((x) => x.version_id === v1)) context.edges.push({ ...e, id: `${v2}-${e.element_key}`, version_id: v2 });
      for (const f of context.activityFields.filter((x) => x.version_id === v1 && x.field_id !== 'f-amount')) {
        context.activityFields.push({ ...f, id: `${v2}-${f.element_key}`, version_id: v2 });
      }
      return v2;
    },
  };
}
