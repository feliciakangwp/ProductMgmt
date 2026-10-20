import {
  analysisToProposal,
  applyDataProposal,
  buildFieldSuggestionPrompt,
  buildRuleTranslationPrompt,
  buildSuggestionContext,
  buildUserMessage,
  businessRuleFromRow,
  columnFromRow,
  EMPTY_RULE_PARAMS,
  emptyDeliveryTables,
  type DeliveryClient,
  type DeliveryTables,
  type ProjectContext,
  fieldFromRow,
  fieldSuggestionsJsonSchema,
  findingFromRow,
  parseFieldSuggestions,
  parseRuleTranslation,
  requirementsFromRows,
  ruleFromRow,
  ruleTranslationJsonSchema,
  suggestionsToProposal,
  toSaveDataPayload,
  translationToProposal,
  type ActivityFieldRow,
  type ActivityOutputRow,
  type BusinessRuleActivityRow,
  type BusinessRuleRow,
  type FieldDefinitionRow,
  type PhysicalColumnRow,
  type SaveDataPayload,
  type ValidationRuleRow,
  graphFromRows,
  hasBlockingIssues,
  normaliseName,
  parseProcessAnalysis,
  processAnalysisJsonSchema,
  resolveProposalActors,
  SYSTEM_PROMPT,
  toSavePayload,
  validateProcess,
  type ActorRow,
  type ProcessAnalysis,
  type ProcessEdgeRow,
  type ProcessFindingRow,
  type ProcessNodeRow,
  type ProcessRow,
  type ProcessVersionRow,
  type ProjectRole,
  type ProjectRow,
} from '@productflow/domain';
import { DEBT_WRITE_OFF_ANALYSIS, DEBT_WRITE_OFF_DESCRIPTION, fieldSuggestionsForPrompt } from '@productflow/domain/testing';
import { AppError } from '../errors';
import { safeStorage } from '../storage';
import { demoAi, runStructured } from './demo-ai';
import { createDemoDelivery } from './demo-delivery';
import { latestFindingPerKey } from './helpers';
import type {
  Backend,
  BusinessRuleInput,
  DemoControls,
  FieldUsage,
  Member,
  NewFieldInput,
  ProcessSummary,
  PromotableFinding,
  SessionInfo,
  ValidationRuleInput,
} from './types';

/**
 * Demo backend: the whole app runs in the browser with no server. Data lives
 * in this viewer's browser storage and follows the same rules as the
 * database functions in supabase/migrations (roles, frozen approved
 * versions, optimistic locking, ref codes). Process analysis asks Claude
 * through the Claude artifact runtime, on the viewer's own account.
 */

interface DemoUser extends SessionInfo {}

interface DemoMember {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  created_at: string;
}

interface DemoMapping {
  project_id: string;
  field_id: string;
  column_id: string;
  transformation: string;
}

interface DemoState {
  schema: 3;
  users: DemoUser[];
  projects: ProjectRow[];
  members: DemoMember[];
  counters: Record<string, number>;
  actors: ActorRow[];
  processes: ProcessRow[];
  versions: ProcessVersionRow[];
  nodes: ProcessNodeRow[];
  edges: ProcessEdgeRow[];
  findings: ProcessFindingRow[];
  runs: { id: string; version_id: string; accepted_at: string | null }[];
  fields: FieldDefinitionRow[];
  rules: ValidationRuleRow[];
  columns: PhysicalColumnRow[];
  mappings: DemoMapping[];
  businessRules: BusinessRuleRow[];
  ruleLinks: BusinessRuleActivityRow[];
  activityFields: ActivityFieldRow[];
  activityOutputs: ActivityOutputRow[];
  /** Phases 3 to 7, kept in the delivery service's own shape. */
  delivery: DeliveryTables;
  /** False until the example delivery history has been written (it is created through the service, asynchronously). */
  deliverySeeded: boolean;
}

const STORAGE_KEY = 'productflow-demo:v3';
export const DEMO_USER_ID = 'demo-user';
const EDITORS: ProjectRole[] = ['admin', 'business_analyst'];
const APPROVERS: ProjectRole[] = ['admin', 'product_owner'];

const now = () => new Date().toISOString();
const uuid = () => globalThis.crypto.randomUUID();

const HARDSHIP_DESCRIPTION = `A customer who cannot pay their debt in full contacts the Collections team to request a hardship payment arrangement.

The Collections Officer verifies the customer's identity and retrieves their account. The officer records the customer's income, expenses and the reason for hardship, and the system calculates a proposed weekly payment.

If the proposed arrangement would clear the debt within 24 months, the officer approves it and the system sends the customer a confirmation letter. If it would take longer, the officer refers the case to a Hardship Specialist, who decides whether to approve a longer arrangement or offer a partial write-off.

If the customer misses two consecutive payments, the arrangement is cancelled and the account returns to standard collections.`;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function nextRef(state: DemoState, projectId: string, prefix: string): string {
  const key = `${projectId}:${prefix}`;
  const value = (state.counters[key] ?? 0) + 1;
  state.counters[key] = value;
  return `${prefix}-${String(value).padStart(3, '0')}`;
}

function nodePrefix(type: ProcessNodeRow['node_type']): string {
  if (type === 'decision') return 'DEC';
  if (type === 'start' || type === 'end') return 'EVT';
  return 'ACT';
}

function seed(): DemoState {
  const t = now();
  const state: DemoState = {
    schema: 3,
    users: [
      { userId: DEMO_USER_ID, email: 'you@demo.productflow', displayName: 'You (demo)' },
      { userId: 'user-priya', email: 'priya.shah@demo.productflow', displayName: 'Priya Shah' },
      { userId: 'user-marcus', email: 'marcus.lee@demo.productflow', displayName: 'Marcus Lee' },
      { userId: 'user-sam', email: 'sam.taylor@demo.productflow', displayName: 'Sam Taylor' },
    ],
    projects: [],
    members: [],
    counters: {},
    actors: [],
    processes: [],
    versions: [],
    nodes: [],
    edges: [],
    findings: [],
    runs: [],
    fields: [],
    rules: [],
    columns: [],
    mappings: [],
    businessRules: [],
    ruleLinks: [],
    activityFields: [],
    activityOutputs: [],
    delivery: emptyDeliveryTables(),
    deliverySeeded: false,
  };

  const project: ProjectRow = {
    id: uuid(),
    key: 'DMM',
    name: 'Debt Management Modernisation',
    description: 'Redesign of debt collection, write-off and hardship processes for the new Debt Management system.',
    created_by: DEMO_USER_ID,
    created_at: t,
    updated_at: t,
  };
  state.projects.push(project);
  state.members.push(
    { project_id: project.id, user_id: DEMO_USER_ID, role: 'admin', created_at: t },
    { project_id: project.id, user_id: 'user-priya', role: 'product_owner', created_at: t },
    { project_id: project.id, user_id: 'user-marcus', role: 'developer', created_at: t },
    { project_id: project.id, user_id: 'user-sam', role: 'business_user', created_at: t },
  );

  // PRC-001: analysed and approved, with an open draft v2.
  const proposal = analysisToProposal(DEBT_WRITE_OFF_ANALYSIS);
  for (const a of proposal.actors) {
    state.actors.push({ id: uuid(), project_id: project.id, name: a.name, kind: a.kind, description: '' });
  }
  const graph = resolveProposalActors(
    proposal,
    state.actors.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
  );
  const writeOff = addProcess(state, project.id, {
    name: 'Debt write-off',
    process_type: 'to_be',
    owner: 'Head of Finance Operations',
    business_unit: 'Finance',
    description: DEBT_WRITE_OFF_DESCRIPTION,
  });
  const payload = toSavePayload({
    versionId: writeOff.versionId,
    expectedRevision: 1,
    description: DEBT_WRITE_OFF_DESCRIPTION,
    graph,
    findings: proposal.findings.map((f) => (f.kind === 'business_rule' ? { ...f, status: 'accepted' } : f)),
  });
  saveDraftIn(state, payload, DEMO_USER_ID);
  seedDataRequirements(state, project.id, writeOff.processId, writeOff.versionId);
  const v1 = state.versions.find((v) => v.id === writeOff.versionId)!;
  v1.status = 'approved';
  v1.approved_by = 'user-priya';
  v1.approved_at = t;
  createDraftIn(state, v1.id, DEMO_USER_ID);

  // PRC-002: a description waiting to be analysed.
  addProcess(state, project.id, {
    name: 'Hardship payment arrangement',
    process_type: 'as_is',
    owner: 'Collections Manager',
    business_unit: 'Collections',
    description: HARDSHIP_DESCRIPTION,
  });
  return state;
}

function load(): DemoState {
  const raw = safeStorage.get(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed.schema === 3) return parsed;
    } catch {
      /* fall through to a fresh seed */
    }
  }
  const fresh = seed();
  safeStorage.set(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

let state: DemoState = load();

function commit() {
  safeStorage.set(STORAGE_KEY, JSON.stringify(state));
}

const copy = <T>(value: T): T => structuredClone(value);

// ---------------------------------------------------------------------------
// Rules shared by several operations (mirroring the SQL functions)
// ---------------------------------------------------------------------------

function roleOf(projectId: string, userId = DEMO_USER_ID): ProjectRole | null {
  return state.members.find((m) => m.project_id === projectId && m.user_id === userId)?.role ?? null;
}

function requireRole(projectId: string, roles: ProjectRole[], message: string) {
  const role = roleOf(projectId);
  if (!role || !roles.includes(role)) throw new AppError(message, '42501');
}

function requireMember(projectId: string) {
  if (!roleOf(projectId)) throw new AppError('Not found.', 'P0002');
}

function addProcess(
  s: DemoState,
  projectId: string,
  input: Pick<ProcessRow, 'name' | 'process_type' | 'owner' | 'business_unit'> & { description: string },
) {
  const t = now();
  const process: ProcessRow = {
    id: uuid(),
    project_id: projectId,
    ref_code: nextRef(s, projectId, 'PRC'),
    name: input.name.trim(),
    process_type: input.process_type,
    owner: input.owner.trim(),
    business_unit: input.business_unit.trim(),
    created_by: DEMO_USER_ID,
    created_at: t,
    updated_at: t,
  };
  const version: ProcessVersionRow = {
    id: uuid(),
    process_id: process.id,
    project_id: projectId,
    version_number: 1,
    status: 'draft',
    description: input.description,
    revision: 1,
    data_revision: 1,
    based_on_version_id: null,
    created_by: DEMO_USER_ID,
    created_at: t,
    updated_at: t,
    updated_by: DEMO_USER_ID,
    approved_by: null,
    approved_at: null,
  };
  s.processes.push(process);
  s.versions.push(version);
  return { processId: process.id, versionId: version.id };
}

function saveDraftIn(s: DemoState, payload: ReturnType<typeof toSavePayload>, userId: string): number {
  const version = s.versions.find((v) => v.id === payload.p_version_id);
  if (!version) throw new AppError('Process version not found', 'P0002');
  if (version.status !== 'draft') {
    throw new AppError(
      `Version ${version.version_number} is ${version.status} and cannot be changed; create a new draft instead`,
      'PF423',
    );
  }
  if (version.revision !== payload.p_expected_revision) {
    throw new AppError('This draft was saved in another tab since you opened it. Reload to see those changes.', 'PF409');
  }
  const projectActors = new Set(s.actors.filter((a) => a.project_id === version.project_id).map((a) => a.id));
  if (payload.p_nodes.some((n) => n.actor_id && !projectActors.has(n.actor_id))) {
    throw new AppError('An actor does not belong to this project', 'PF422');
  }
  for (const list of [payload.p_nodes, payload.p_edges, payload.p_findings]) {
    if (new Set(list.map((x) => x.element_key)).size !== list.length) {
      throw new AppError('Save payload contains duplicate element keys', 'PF422');
    }
  }
  const nodeKeys = new Set(payload.p_nodes.map((n) => n.element_key));
  if (payload.p_edges.some((e) => !nodeKeys.has(e.source_key) || !nodeKeys.has(e.target_key) || e.source_key === e.target_key)) {
    throw new AppError('A connection points to a step that does not exist', '23503');
  }

  const t = now();
  const existingNodes = new Map(s.nodes.filter((n) => n.version_id === version.id).map((n) => [n.element_key, n]));
  s.nodes = s.nodes.filter((n) => n.version_id !== version.id);
  // Removing an activity removes its inputs and outputs, as the foreign key cascade does in the database.
  s.activityFields = s.activityFields.filter((f) => f.version_id !== version.id || nodeKeys.has(f.node_key));
  s.activityOutputs = s.activityOutputs.filter((o) => o.version_id !== version.id || nodeKeys.has(o.node_key));
  for (const n of payload.p_nodes) {
    const previous = existingNodes.get(n.element_key);
    const refCode =
      previous?.ref_code ??
      s.nodes.find((o) => o.project_id === version.project_id && o.element_key === n.element_key && o.ref_code)?.ref_code ??
      nextRef(s, version.project_id, nodePrefix(n.node_type));
    s.nodes.push({ id: previous?.id ?? uuid(), version_id: version.id, project_id: version.project_id, ref_code: refCode, ...n });
  }
  const existingEdges = new Map(s.edges.filter((e) => e.version_id === version.id).map((e) => [e.element_key, e]));
  s.edges = s.edges.filter((e) => e.version_id !== version.id);
  for (const e of payload.p_edges) {
    s.edges.push({
      id: existingEdges.get(e.element_key)?.id ?? uuid(),
      version_id: version.id,
      project_id: version.project_id,
      ...e,
    });
  }
  const existingFindings = new Map(s.findings.filter((f) => f.version_id === version.id).map((f) => [f.element_key, f]));
  s.findings = s.findings.filter((f) => f.version_id !== version.id);
  for (const f of payload.p_findings) {
    const previous = existingFindings.get(f.element_key);
    s.findings.push({
      id: previous?.id ?? uuid(),
      version_id: version.id,
      project_id: version.project_id,
      analysis_run_id: previous?.analysis_run_id ?? (f.origin !== 'manual' ? payload.p_analysis_run_id : null),
      ...f,
    });
  }
  if (payload.p_analysis_run_id) {
    const run = s.runs.find((r) => r.id === payload.p_analysis_run_id);
    if (run && !run.accepted_at) run.accepted_at = t;
  }
  version.description = payload.p_description;
  version.revision += 1;
  version.updated_at = t;
  version.updated_by = userId;
  return version.revision;
}

function createDraftIn(s: DemoState, versionId: string, userId: string): string {
  const source = s.versions.find((v) => v.id === versionId);
  if (!source) throw new AppError('Process version not found', 'P0002');
  const open = s.versions.find((v) => v.process_id === source.process_id && v.status === 'draft');
  if (open) throw new AppError(`Version ${open.version_number} is already an open draft for this process`, 'PF409');
  const t = now();
  const next = Math.max(...s.versions.filter((v) => v.process_id === source.process_id).map((v) => v.version_number)) + 1;
  const draft: ProcessVersionRow = {
    ...source,
    id: uuid(),
    version_number: next,
    status: 'draft',
    revision: 1,
    data_revision: 1,
    based_on_version_id: source.id,
    created_by: userId,
    created_at: t,
    updated_at: t,
    updated_by: userId,
    approved_by: null,
    approved_at: null,
  };
  s.versions.push(draft);
  s.nodes.push(...s.nodes.filter((n) => n.version_id === source.id).map((n) => ({ ...n, id: uuid(), version_id: draft.id })));
  s.edges.push(...s.edges.filter((e) => e.version_id === source.id).map((e) => ({ ...e, id: uuid(), version_id: draft.id })));
  s.findings.push(
    ...s.findings.filter((f) => f.version_id === source.id).map((f) => ({ ...f, id: uuid(), version_id: draft.id })),
  );
  s.activityFields.push(
    ...s.activityFields.filter((f) => f.version_id === source.id).map((f) => ({ ...f, id: uuid(), version_id: draft.id })),
  );
  s.activityOutputs.push(
    ...s.activityOutputs.filter((o) => o.version_id === source.id).map((o) => ({ ...o, id: uuid(), version_id: draft.id })),
  );
  return draft.id;
}

function versionGraph(versionId: string) {
  return graphFromRows(
    state.nodes.filter((n) => n.version_id === versionId),
    state.edges.filter((e) => e.version_id === versionId),
  );
}

// ---------------------------------------------------------------------------
// Data requirements (Phase 2), mirroring supabase/migrations/*_data_requirements.sql
// ---------------------------------------------------------------------------

function insertField(s: DemoState, projectId: string, input: NewFieldInput): FieldDefinitionRow {
  const row: FieldDefinitionRow = {
    id: uuid(),
    project_id: projectId,
    ref_code: nextRef(s, projectId, 'FLD'),
    name: input.name.trim(),
    description: input.description,
    data_type: input.dataType,
    allowed_values: input.allowedValues,
    default_value: input.defaultValue,
    source: input.source,
    source_detail: input.sourceDetail,
    status: input.status ?? 'draft',
    origin: input.origin,
    revision: 1,
  };
  if (!row.name) throw new AppError('Some values are not in the expected format.', '23514');
  s.fields.push(row);
  return row;
}

function insertRule(s: DemoState, projectId: string, input: ValidationRuleInput): ValidationRuleRow {
  if (!s.fields.some((f) => f.id === input.fieldId && f.project_id === projectId)) {
    throw new AppError('Linked records must belong to the same project', 'PF422');
  }
  const row: ValidationRuleRow = {
    id: uuid(),
    project_id: projectId,
    field_id: input.fieldId,
    ref_code: nextRef(s, projectId, 'VR'),
    rule_type: input.ruleType,
    params: input.params,
    statement: input.statement,
    error_message: input.errorMessage,
    source_text: input.sourceText,
    origin: input.origin,
    status: input.status,
    business_rule_id: input.businessRuleId,
  };
  s.rules.push(row);
  return row;
}

function insertBusinessRule(
  s: DemoState,
  projectId: string,
  input: BusinessRuleInput & { source?: { versionId: string; findingKey: string } },
): BusinessRuleRow {
  const row: BusinessRuleRow = {
    id: uuid(),
    project_id: projectId,
    ref_code: nextRef(s, projectId, 'BR'),
    title: input.title.trim(),
    statement: input.statement.trim(),
    category: input.category,
    status: 'draft',
    origin: input.origin,
    source_version_id: input.source?.versionId ?? null,
    source_finding_key: input.source?.findingKey ?? null,
    revision: 1,
  };
  s.businessRules.push(row);
  setRuleLinks(s, projectId, row.id, input.activities);
  return row;
}

function setRuleLinks(s: DemoState, projectId: string, ruleId: string, activities: BusinessRuleInput['activities']) {
  s.ruleLinks = s.ruleLinks.filter((l) => l.business_rule_id !== ruleId);
  const seen = new Set<string>();
  for (const a of activities) {
    const key = `${a.processId}|${a.nodeKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    s.ruleLinks.push({ business_rule_id: ruleId, project_id: projectId, process_id: a.processId, node_key: a.nodeKey });
  }
}

function writeVersionData(s: DemoState, version: ProcessVersionRow, payload: SaveDataPayload) {
  const nodes = new Map(s.nodes.filter((n) => n.version_id === version.id).map((n) => [n.element_key, n]));
  const activityKeys = [...payload.p_fields.map((f) => f.node_key), ...payload.p_outputs.map((o) => o.node_key)];
  if (activityKeys.some((k) => !nodes.has(k) || ['start', 'end'].includes(nodes.get(k)!.node_type))) {
    throw new AppError("Inputs and outputs must belong to activities in this version's process map", 'PF422');
  }
  if (payload.p_fields.some((f) => !s.fields.some((d) => d.id === f.field_id && d.project_id === version.project_id))) {
    throw new AppError("A field is not in this project's data dictionary", 'PF422');
  }
  const uses = new Set<string>();
  for (const f of payload.p_fields) {
    const key = `${f.node_key}|${f.direction}|${f.field_id}`;
    if (uses.has(key)) throw new AppError('That field is already used by this activity.', '23505');
    uses.add(key);
  }
  s.activityFields = s.activityFields.filter((f) => f.version_id !== version.id);
  s.activityOutputs = s.activityOutputs.filter((o) => o.version_id !== version.id);
  s.activityFields.push(
    ...payload.p_fields.map((f) => ({
      ...f,
      id: uuid(),
      version_id: version.id,
      project_id: version.project_id,
      mandatory: f.direction === 'output' ? ('no' as const) : f.mandatory,
      mandatory_condition: f.direction === 'input' && f.mandatory === 'conditional' ? f.mandatory_condition : '',
    })),
  );
  s.activityOutputs.push(
    ...payload.p_outputs.map((o) => ({ ...o, id: uuid(), version_id: version.id, project_id: version.project_id })),
  );
  version.data_revision += 1;
  version.updated_at = now();
}

/** Example data requirements for the debt write-off process, built from the shared test fixture. */
function seedDataRequirements(s: DemoState, projectId: string, processId: string, versionId: string) {
  const version = s.versions.find((v) => v.id === versionId)!;
  const graph = graphFromRows(
    s.nodes.filter((n) => n.version_id === versionId),
    s.edges.filter((e) => e.version_id === versionId),
  );
  const actors = s.actors.filter((a) => a.project_id === projectId).map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
  const { context, keyByActivityId } = buildSuggestionContext({
    processName: 'Debt write-off',
    description: version.description,
    graph,
    actors,
    dictionary: [],
    businessRules: [],
  });
  const suggestions = fieldSuggestionsForPrompt(buildFieldSuggestionPrompt(context).user);
  const proposal = suggestionsToProposal(suggestions, { keyByActivityId, dictionary: [], current: { fields: [], outputs: [] } });
  const idByKey = new Map<string, string>();
  for (const draft of proposal.newFields) {
    // Two fields are left as drafts so the dictionary shows what still needs confirming.
    const status = ['Rejection Reason', 'Approver ID'].includes(draft.name) ? 'draft' : 'approved';
    idByKey.set(draft.key, insertField(s, projectId, { ...draft, defaultValue: '', status }).id);
  }
  const requirements = applyDataProposal(
    { fields: [], outputs: [] },
    { fields: proposal.fields, outputs: proposal.outputs, fieldIdByNewKey: idByKey },
  );
  writeVersionData(
    s,
    version,
    toSaveDataPayload({ versionId, expectedRevision: 1, requirements, nodeKeys: new Set(graph.nodes.map((n) => n.elementKey)) }),
  );

  const fieldId = (name: string) => s.fields.find((f) => f.project_id === projectId && f.name === name)!.id;
  const nodeKey = (label: string) => graph.nodes.find((n) => n.label === label)!.elementKey;
  const eligibility = s.findings.find((f) => f.version_id === versionId && f.kind === 'business_rule')!;
  const fiveYears = insertBusinessRule(s, projectId, {
    title: 'Five-year eligibility',
    statement: eligibility.statement,
    category: 'eligibility',
    origin: eligibility.origin,
    activities: eligibility.related_node_keys.map((k) => ({ processId, nodeKey: k })),
    source: { versionId, findingKey: eligibility.element_key },
  });
  Object.assign(fiveYears, { status: 'approved', revision: 2 });
  const director = insertBusinessRule(s, projectId, {
    title: 'Director approval above $10,000',
    statement: 'Write-off requests where the outstanding amount exceeds $10,000 require Director approval.',
    category: 'approval',
    origin: 'manual',
    activities: [{ processId, nodeKey: nodeKey('Review write-off request') }],
  });

  insertRule(s, projectId, {
    fieldId: fieldId('Outstanding Amount'),
    ruleType: 'range',
    params: { ...EMPTY_RULE_PARAMS, min: 0, exclusive: true },
    statement: 'Outstanding amount must be greater than zero.',
    errorMessage: 'Enter an outstanding amount greater than zero.',
    sourceText: 'Outstanding amount must be greater than zero.',
    origin: 'stated',
    status: 'confirmed',
    businessRuleId: null,
  });
  insertRule(s, projectId, {
    fieldId: fieldId('Write-Off Reason'),
    ruleType: 'length',
    params: { ...EMPTY_RULE_PARAMS, maxLength: 500 },
    statement: 'Write-off reason must be 500 characters or fewer.',
    errorMessage: 'Shorten the reason to 500 characters or fewer.',
    sourceText: null,
    origin: 'manual',
    status: 'confirmed',
    businessRuleId: null,
  });
  insertRule(s, projectId, {
    fieldId: fieldId('Debt ID'),
    ruleType: 'lookup',
    params: { ...EMPTY_RULE_PARAMS, lookupSource: 'Debt records (open debts only)' },
    statement: 'Debt ID must exist in debt records and must not refer to a closed debt.',
    errorMessage: 'No open debt has this ID. Check the number and try again.',
    sourceText: null,
    origin: 'inferred',
    status: 'draft',
    businessRuleId: null,
  });
  insertRule(s, projectId, {
    fieldId: fieldId('Supporting Document'),
    ruleType: 'conditional_required',
    params: { ...EMPTY_RULE_PARAMS, condition: 'Outstanding amount exceeds $10,000' },
    statement: 'A supporting document is required when the outstanding amount exceeds $10,000.',
    errorMessage: 'Attach a supporting document for write-offs over $10,000.',
    sourceText: null,
    origin: 'manual',
    status: 'confirmed',
    businessRuleId: director.id,
  });

  const column = (table: string, name: string, type: string) => {
    const row: PhysicalColumnRow = {
      id: uuid(),
      project_id: projectId,
      system_name: 'Debt Management DB',
      table_name: table,
      column_name: name,
      data_type: type,
      notes: '',
    };
    s.columns.push(row);
    return row.id;
  };
  const debtId = column('debts', 'debt_id', 'uuid');
  const principal = column('debts', 'principal_cents', 'bigint');
  const interest = column('debts', 'interest_cents', 'bigint');
  column('write_off_requests', 'reason', 'text');
  s.mappings.push(
    { project_id: projectId, field_id: fieldId('Debt ID'), column_id: debtId, transformation: '' },
    {
      project_id: projectId,
      field_id: fieldId('Outstanding Amount'),
      column_id: principal,
      transformation: '(principal + interest) / 100',
    },
    {
      project_id: projectId,
      field_id: fieldId('Outstanding Amount'),
      column_id: interest,
      transformation: '(principal + interest) / 100',
    },
  );
}

// ---------------------------------------------------------------------------
// Claude (see demo-ai.ts)
// ---------------------------------------------------------------------------

function analyseWithClaude(
  request: { description: string; processName: string; processType: string },
  signal?: AbortSignal,
): Promise<{ value: ProcessAnalysis; model: string }> {
  const user = buildUserMessage(request);
  return runStructured({
    system: SYSTEM_PROMPT,
    user,
    schema: processAnalysisJsonSchema(),
    parse: parseProcessAnalysis,
    signal,
  });
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

const listeners = new Set<(session: SessionInfo | null) => void>();
const demoUser = () => state.users.find((u) => u.userId === DEMO_USER_ID)!;

// ---------------------------------------------------------------------------
// Delivery (Phases 3 to 7): the shared delivery service over this state
// ---------------------------------------------------------------------------

function projectContext(projectId: string): ProjectContext {
  const project = state.projects.find((p) => p.id === projectId)!;
  const inProject = <T extends { project_id: string }>(rows: T[]) => rows.filter((r) => r.project_id === projectId);
  return {
    projectId,
    projectKey: project?.key ?? '',
    processes: inProject(state.processes),
    versions: inProject(state.versions),
    nodes: inProject(state.nodes),
    edges: inProject(state.edges),
    actors: inProject(state.actors).map((a) => ({ id: a.id, name: a.name })),
    activityFields: inProject(state.activityFields),
    fields: inProject(state.fields).map(fieldFromRow),
    validationRules: inProject(state.rules).map(ruleFromRow),
    businessRules: inProject(state.businessRules).map((r) => businessRuleFromRow(r, state.ruleLinks)),
    columns: inProject(state.columns).map(columnFromRow),
    columnMappings: inProject(state.mappings).map((m) => ({
      fieldId: m.field_id,
      columnId: m.column_id,
      transformation: m.transformation,
    })),
    members: inProject(state.members).map((m) => ({
      userId: m.user_id,
      role: m.role,
      displayName: state.users.find((u) => u.userId === m.user_id)?.displayName ?? '',
    })),
  };
}

const delivery = createDemoDelivery({
  userId: DEMO_USER_ID,
  tables: () => state.delivery,
  replaceTables: (tables) => {
    state.delivery = tables;
  },
  context: projectContext,
  memberRole: (projectId, userId) => roleOf(projectId, userId),
  nextRef: (projectId, prefix) => nextRef(state, projectId, prefix),
  processProject: (processId) => state.processes.find((p) => p.id === processId)?.project_id ?? null,
  commit,
});

let deliveryReady: Promise<void> | null = null;

/** Writes the example delivery history once, the first time delivery data is needed. */
function ensureDeliverySeed(): Promise<void> {
  deliveryReady ??= (async () => {
    if (state.deliverySeeded) return;
    const project = state.projects.find((p) => p.key === 'DMM');
    const process = project && state.processes.find((p) => p.project_id === project.id && p.ref_code === 'PRC-001');
    if (project && process) {
      // The example history is written by the seeded team, whatever role the viewer chose.
      const myRole = roleOf(project.id);
      const me = state.members.find((m) => m.project_id === project.id && m.user_id === DEMO_USER_ID);
      if (me) me.role = 'admin';
      try {
        await delivery.seed(project.id, process.id, {
          admin: DEMO_USER_ID,
          productOwner: 'user-priya',
          developer: 'user-marcus',
        });
      } finally {
        if (me && myRole) me.role = myRole;
      }
    }
    state.deliverySeeded = true;
    commit();
  })();
  return deliveryReady;
}

const deliveryClient = new Proxy({} as DeliveryClient, {
  get: (_target, op: string) => async (input: unknown, signal?: AbortSignal) => {
    await ensureDeliverySeed();
    return (delivery.client as unknown as Record<string, (i: unknown, s?: AbortSignal) => Promise<unknown>>)[op]!(input, signal);
  },
});

const demoControls: DemoControls = {
  reset() {
    state = seed();
    deliveryReady = null;
    commit();
  },
  ai: demoAi,
  setMyRole(projectId, role) {
    const member = state.members.find((m) => m.project_id === projectId && m.user_id === DEMO_USER_ID);
    if (member) member.role = role;
    commit();
  },
  myRole: (projectId) => roleOf(projectId),
};

export function createBackend(): Backend {
  return {
    mode: 'demo',
    demo: demoControls,
    delivery: deliveryClient,

    auth: {
      async getSession() {
        return copy(demoUser());
      },
      onChange(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      async signIn() {},
      async signUp() {
        return { needsConfirmation: false };
      },
      async signOut() {},
    },

    async listMyProjects(userId) {
      return copy(
        state.members
          .filter((m) => m.user_id === userId)
          .map((m) => ({ ...state.projects.find((p) => p.id === m.project_id)!, role: m.role }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    },

    async createProject(input) {
      const key = input.key.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) throw new AppError('Some values are not in the expected format.', '23514');
      if (state.projects.some((p) => p.key === key)) throw new AppError(`A project with key ${key} already exists`, 'PF409');
      const t = now();
      const project: ProjectRow = {
        id: uuid(),
        key,
        name: input.name.trim(),
        description: input.description,
        created_by: DEMO_USER_ID,
        created_at: t,
        updated_at: t,
      };
      state.projects.push(project);
      state.members.push({ project_id: project.id, user_id: DEMO_USER_ID, role: 'admin', created_at: t });
      commit();
      return copy(project);
    },

    async updateProject(input) {
      requireRole(input.id, ['admin'], 'Only project administrators can change project details.');
      const project = state.projects.find((p) => p.id === input.id)!;
      Object.assign(project, { name: input.name, description: input.description, updated_at: now() });
      commit();
    },

    async listMembers(projectId) {
      requireMember(projectId);
      return state.members
        .filter((m) => m.project_id === projectId)
        .map((m): Member => {
          const user = state.users.find((u) => u.userId === m.user_id)!;
          return { userId: m.user_id, role: m.role, displayName: user.displayName, email: user.email, createdAt: m.created_at };
        });
    },

    async addMember(projectId, email, role) {
      requireRole(projectId, ['admin'], 'Only project administrators can manage members');
      const user = state.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      if (!user) {
        const known = state.users.filter((u) => !roleOf(projectId, u.userId)).map((u) => u.email);
        throw new AppError(
          `No user with email ${email.trim()} has signed up yet.${known.length ? ` In this demo you can add ${known.join(', ')}.` : ''}`,
          'P0002',
        );
      }
      if (roleOf(projectId, user.userId)) throw new AppError(`${email.trim()} is already a member of this project`, 'PF409');
      state.members.push({ project_id: projectId, user_id: user.userId, role, created_at: now() });
      commit();
    },

    async updateMemberRole(projectId, userId, role) {
      requireRole(projectId, ['admin'], 'Only project administrators can manage members');
      const others = state.members.filter((m) => m.project_id === projectId && m.role === 'admin' && m.user_id !== userId);
      if (role !== 'admin' && others.length === 0) throw new AppError('A project must keep at least one administrator', 'PF422');
      state.members.find((m) => m.project_id === projectId && m.user_id === userId)!.role = role;
      commit();
    },

    async removeMember(projectId, userId) {
      requireRole(projectId, ['admin'], 'Only project administrators can manage members');
      const others = state.members.filter((m) => m.project_id === projectId && m.role === 'admin' && m.user_id !== userId);
      if (others.length === 0) throw new AppError('A project must keep at least one administrator', 'PF422');
      state.members = state.members.filter((m) => !(m.project_id === projectId && m.user_id === userId));
      commit();
    },

    async listProcesses(projectId) {
      requireMember(projectId);
      return copy(
        state.processes
          .filter((p) => p.project_id === projectId)
          .sort((a, b) => a.ref_code.localeCompare(b.ref_code))
          .map((p): ProcessSummary => ({
            ...p,
            versions: state.versions
              .filter((v) => v.process_id === p.id)
              .sort((a, b) => b.version_number - a.version_number)
              .map(({ id, version_number, status, updated_at, approved_at }) => ({
                id,
                version_number,
                status,
                updated_at,
                approved_at,
              })),
          })),
      );
    },

    async createProcess(input) {
      requireRole(input.projectId, EDITORS, 'You do not have permission to create processes in this project');
      const ids = addProcess(state, input.projectId, {
        name: input.name,
        process_type: input.processType,
        owner: input.owner,
        business_unit: input.businessUnit,
        description: input.description,
      });
      commit();
      return { process_id: ids.processId, version_id: ids.versionId };
    },

    async getProcessDetail(processId) {
      const process = state.processes.find((p) => p.id === processId);
      if (!process || !roleOf(process.project_id)) return null;
      return copy({
        process,
        versions: state.versions.filter((v) => v.process_id === processId).sort((a, b) => b.version_number - a.version_number),
      });
    },

    async updateProcessDetails(processId, input) {
      const process = state.processes.find((p) => p.id === processId);
      if (!process) throw new AppError('Process not found', 'P0002');
      requireRole(process.project_id, EDITORS, 'You do not have permission to edit this process.');
      Object.assign(process, {
        name: input.name.trim(),
        process_type: input.processType,
        owner: input.owner.trim(),
        business_unit: input.businessUnit.trim(),
        updated_at: now(),
      });
      commit();
    },

    async getVersionContent(versionId) {
      const version = state.versions.find((v) => v.id === versionId);
      if (!version) throw new AppError('Process version not found', 'P0002');
      requireMember(version.project_id);
      return copy({
        version,
        graph: versionGraph(versionId),
        findings: state.findings.filter((f) => f.version_id === versionId).map(findingFromRow),
      });
    },

    async saveDraft(payload) {
      const version = state.versions.find((v) => v.id === payload.p_version_id);
      if (!version) throw new AppError('Process version not found', 'P0002');
      requireRole(version.project_id, EDITORS, 'You do not have permission to edit this process');
      const revision = saveDraftIn(state, copy(payload), DEMO_USER_ID);
      commit();
      return revision;
    },

    async approveVersion(versionId, revision) {
      const version = state.versions.find((v) => v.id === versionId);
      if (!version) throw new AppError('Process version not found', 'P0002');
      requireRole(version.project_id, APPROVERS, 'Only a Product Owner or Administrator can approve a process');
      if (version.status !== 'draft') {
        throw new AppError(`Version ${version.version_number} is already ${version.status}`, 'PF423');
      }
      if (version.revision !== revision) {
        throw new AppError('This draft changed since you reviewed it. Reload and review it again before approving.', 'PF409');
      }
      const issues = validateProcess(versionGraph(versionId));
      if (versionGraph(versionId).nodes.length === 0 || hasBlockingIssues(issues)) {
        const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message);
        throw new AppError(`The process cannot be approved: ${errors.join('; ') || 'The process map is empty'}`, 'PF422');
      }
      for (const v of state.versions) {
        if (v.process_id === version.process_id && v.status === 'approved') v.status = 'superseded';
      }
      Object.assign(version, { status: 'approved', approved_by: DEMO_USER_ID, approved_at: now() });
      commit();
    },

    async createDraftFromVersion(versionId) {
      const version = state.versions.find((v) => v.id === versionId);
      if (!version) throw new AppError('Process version not found', 'P0002');
      requireRole(version.project_id, EDITORS, 'You do not have permission to edit this process');
      const id = createDraftIn(state, versionId, DEMO_USER_ID);
      commit();
      return id;
    },

    async listActors(projectId) {
      requireMember(projectId);
      return state.actors
        .filter((a) => a.project_id === projectId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
    },

    async createActor(projectId, input) {
      requireRole(projectId, EDITORS, 'You do not have permission to edit actors in this project');
      const name = input.name.trim();
      if (state.actors.some((a) => a.project_id === projectId && normaliseName(a.name) === normaliseName(name))) {
        throw new AppError('That name is already in use.', '23505');
      }
      const actor: ActorRow = { id: uuid(), project_id: projectId, name, kind: input.kind, description: '' };
      state.actors.push(actor);
      commit();
      return { id: actor.id, name: actor.name, kind: actor.kind };
    },

    async ensureActors(projectId, actors) {
      requireRole(projectId, EDITORS, 'You do not have permission to edit actors in this project');
      const wanted = new Set(actors.map((a) => normaliseName(a.name)));
      for (const a of actors) {
        const exists = state.actors.some((x) => x.project_id === projectId && normaliseName(x.name) === normaliseName(a.name));
        if (!exists && a.name.trim()) {
          state.actors.push({ id: uuid(), project_id: projectId, name: a.name.trim(), kind: a.kind, description: '' });
        }
      }
      commit();
      return state.actors
        .filter((a) => a.project_id === projectId && wanted.has(normaliseName(a.name)))
        .map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
    },

    async analyseProcess({ versionId, description }, signal) {
      const version = state.versions.find((v) => v.id === versionId);
      if (!version) throw new AppError('Process version not found.', 'not_found');
      requireRole(version.project_id, EDITORS, 'Only Business Analysts and Administrators can run process analysis.');
      if (version.status !== 'draft') {
        throw new AppError('This version is not a draft. Create a new draft to change the process.', 'version_locked');
      }
      const text = description.trim();
      if (text.length < 20) throw new AppError('Describe the process in at least a sentence or two before analysing it.');
      if (text.length > 20000) throw new AppError('The description must be 20000 characters or fewer.');
      const process = state.processes.find((p) => p.id === version.process_id)!;
      const { value: analysis, model } = await analyseWithClaude(
        { description: text, processName: process.name, processType: process.process_type },
        signal,
      );
      const runId = uuid();
      state.runs.push({ id: runId, version_id: versionId, accepted_at: null });
      commit();
      return { runId, model, proposal: analysisToProposal(analysis) };
    },

    // -------------------------------------------------------------------
    // Phase 2: data requirements
    // -------------------------------------------------------------------

    async listFields(projectId) {
      requireMember(projectId);
      return state.fields
        .filter((f) => f.project_id === projectId)
        .sort((a, b) => a.ref_code.localeCompare(b.ref_code))
        .map((f) => fieldFromRow(copy(f)));
    },

    async createFields(projectId, fields) {
      requireRole(projectId, EDITORS, 'You do not have permission to edit the data dictionary.');
      const rows = fields.map((f) => insertField(state, projectId, f));
      commit();
      return rows.map((r) => fieldFromRow(copy(r)));
    },

    async updateField(field) {
      const row = state.fields.find((f) => f.id === field.id);
      if (!row) throw new AppError('Field not found', 'P0002');
      requireRole(row.project_id, EDITORS, 'You do not have permission to edit the data dictionary.');
      if (row.revision !== field.revision) {
        throw new AppError(
          `${row.ref_code} was changed in another tab since you opened it. Reload to see those changes.`,
          'PF409',
        );
      }
      if (!field.name.trim()) throw new AppError('Some values are not in the expected format.', '23514');
      Object.assign(row, {
        name: field.name.trim(),
        description: field.description,
        data_type: field.dataType,
        allowed_values: field.allowedValues,
        default_value: field.defaultValue,
        source: field.source,
        source_detail: field.sourceDetail,
        status: field.status,
        revision: row.revision + 1,
      });
      commit();
      return fieldFromRow(copy(row));
    },

    async deleteField(fieldId) {
      const row = state.fields.find((f) => f.id === fieldId);
      if (!row) return;
      requireRole(row.project_id, EDITORS, 'You do not have permission to delete this field.');
      if (state.activityFields.some((f) => f.field_id === fieldId)) {
        throw new AppError(`Field ${row.ref_code} is used by a process activity. Deprecate it instead of deleting it.`, 'PF423');
      }
      state.fields = state.fields.filter((f) => f.id !== fieldId);
      state.rules = state.rules.filter((r) => r.field_id !== fieldId);
      state.mappings = state.mappings.filter((m) => m.field_id !== fieldId);
      commit();
    },

    async listFieldUsages(projectId) {
      requireMember(projectId);
      return state.activityFields
        .filter((f) => f.project_id === projectId)
        .map((f): FieldUsage => {
          const version = state.versions.find((v) => v.id === f.version_id)!;
          const process = state.processes.find((p) => p.id === version.process_id)!;
          const node = state.nodes.find((n) => n.version_id === f.version_id && n.element_key === f.node_key);
          return {
            fieldId: f.field_id,
            direction: f.direction,
            processId: process.id,
            processRef: process.ref_code,
            processName: process.name,
            versionId: version.id,
            versionNumber: version.version_number,
            versionStatus: version.status,
            nodeKey: f.node_key,
            nodeRef: node?.ref_code ?? null,
            nodeLabel: node?.label ?? '',
          };
        });
    },

    async listValidationRules(projectId) {
      requireMember(projectId);
      return state.rules
        .filter((r) => r.project_id === projectId)
        .sort((a, b) => a.ref_code.localeCompare(b.ref_code))
        .map((r) => ruleFromRow(copy(r)));
    },

    async createValidationRule(projectId, input) {
      requireRole(projectId, EDITORS, 'You do not have permission to edit validation rules.');
      const row = insertRule(state, projectId, input);
      commit();
      return ruleFromRow(copy(row));
    },

    async updateValidationRule(rule) {
      const row = state.rules.find((r) => r.id === rule.id);
      if (!row) throw new AppError('Rule not found', 'P0002');
      requireRole(row.project_id, EDITORS, 'You do not have permission to change this rule.');
      Object.assign(row, {
        rule_type: rule.ruleType,
        params: rule.params,
        statement: rule.statement,
        error_message: rule.errorMessage,
        status: rule.status,
        business_rule_id: rule.businessRuleId,
      });
      commit();
      return ruleFromRow(copy(row));
    },

    async deleteValidationRule(ruleId) {
      const row = state.rules.find((r) => r.id === ruleId);
      if (!row) return;
      requireRole(row.project_id, EDITORS, 'You do not have permission to change this rule.');
      state.rules = state.rules.filter((r) => r.id !== ruleId);
      commit();
    },

    async listPhysicalColumns(projectId) {
      requireMember(projectId);
      return state.columns
        .filter((c) => c.project_id === projectId)
        .sort((a, b) =>
          `${a.system_name}.${a.table_name}.${a.column_name}`.localeCompare(`${b.system_name}.${b.table_name}.${b.column_name}`),
        )
        .map((c) => columnFromRow(copy(c)));
    },

    async createPhysicalColumn(projectId, input) {
      requireRole(projectId, EDITORS, 'You do not have permission to edit the data dictionary.');
      const key = (c: { system_name: string; table_name: string; column_name: string }) =>
        `${c.system_name}.${c.table_name}.${c.column_name}`.toLowerCase();
      const row: PhysicalColumnRow = {
        id: uuid(),
        project_id: projectId,
        system_name: input.systemName.trim(),
        table_name: input.tableName.trim(),
        column_name: input.columnName.trim(),
        data_type: input.dataType.trim(),
        notes: input.notes,
      };
      if (!row.system_name || !row.table_name || !row.column_name)
        throw new AppError('Some values are not in the expected format.', '23514');
      if (state.columns.some((c) => c.project_id === projectId && key(c) === key(row)))
        throw new AppError('That name is already in use.', '23505');
      state.columns.push(row);
      commit();
      return columnFromRow(copy(row));
    },

    async deletePhysicalColumn(columnId) {
      const row = state.columns.find((c) => c.id === columnId);
      if (!row) return;
      requireRole(row.project_id, EDITORS, 'You do not have permission to edit the data dictionary.');
      state.columns = state.columns.filter((c) => c.id !== columnId);
      state.mappings = state.mappings.filter((m) => m.column_id !== columnId);
      commit();
    },

    async listColumnMappings(projectId) {
      requireMember(projectId);
      return state.mappings
        .filter((m) => m.project_id === projectId)
        .map((m) => ({ fieldId: m.field_id, columnId: m.column_id, transformation: m.transformation }));
    },

    async addColumnMapping(projectId, mapping) {
      requireRole(projectId, EDITORS, 'You do not have permission to edit the data dictionary.');
      if (state.mappings.some((m) => m.field_id === mapping.fieldId && m.column_id === mapping.columnId)) {
        throw new AppError('That column is already mapped to this field.', '23505');
      }
      state.mappings.push({
        project_id: projectId,
        field_id: mapping.fieldId,
        column_id: mapping.columnId,
        transformation: mapping.transformation,
      });
      commit();
    },

    async removeColumnMapping(fieldId, columnId) {
      const field = state.fields.find((f) => f.id === fieldId);
      if (field) requireRole(field.project_id, EDITORS, 'You do not have permission to edit the data dictionary.');
      state.mappings = state.mappings.filter((m) => !(m.field_id === fieldId && m.column_id === columnId));
      commit();
    },

    async listBusinessRules(projectId) {
      requireMember(projectId);
      return state.businessRules
        .filter((r) => r.project_id === projectId)
        .sort((a, b) => a.ref_code.localeCompare(b.ref_code))
        .map((r) => businessRuleFromRow(copy(r), copy(state.ruleLinks)));
    },

    async createBusinessRule(projectId, input) {
      requireRole(projectId, EDITORS, 'You do not have permission to manage business rules.');
      if (!input.title.trim() || !input.statement.trim())
        throw new AppError('Some values are not in the expected format.', '23514');
      const row = insertBusinessRule(state, projectId, input);
      commit();
      return businessRuleFromRow(copy(row), copy(state.ruleLinks));
    },

    async updateBusinessRule(rule) {
      const row = state.businessRules.find((r) => r.id === rule.id);
      if (!row) throw new AppError('Business rule not found', 'P0002');
      requireRole(row.project_id, [...EDITORS, 'product_owner'], 'You do not have permission to change this business rule.');
      if (row.revision !== rule.revision) {
        throw new AppError(
          `${row.ref_code} was changed in another tab since you opened it. Reload to see those changes.`,
          'PF409',
        );
      }
      if (rule.status === 'approved' && row.status !== 'approved') {
        requireRole(row.project_id, APPROVERS, 'Only a Product Owner or Administrator can approve a business rule');
      }
      if (
        row.status === 'approved' &&
        rule.status === 'approved' &&
        (rule.statement !== row.statement || rule.title !== row.title || rule.category !== row.category)
      ) {
        throw new AppError('An approved business rule cannot be reworded. Return it to draft first.', 'PF423');
      }
      Object.assign(row, {
        title: rule.title,
        statement: rule.statement,
        category: rule.category,
        status: rule.status,
        revision: row.revision + 1,
      });
      setRuleLinks(state, row.project_id, row.id, rule.activities);
      commit();
      return businessRuleFromRow(copy(row), copy(state.ruleLinks));
    },

    async deleteBusinessRule(ruleId) {
      const row = state.businessRules.find((r) => r.id === ruleId);
      if (!row) return;
      requireRole(row.project_id, EDITORS, 'You do not have permission to manage business rules.');
      if (row.status === 'approved')
        throw new AppError('An approved business rule cannot be deleted. Retire it instead.', 'PF423');
      state.businessRules = state.businessRules.filter((r) => r.id !== ruleId);
      state.ruleLinks = state.ruleLinks.filter((l) => l.business_rule_id !== ruleId);
      for (const r of state.rules) if (r.business_rule_id === ruleId) r.business_rule_id = null;
      commit();
    },

    async listPromotableFindings(projectId) {
      requireMember(projectId);
      const promoted = new Set(state.businessRules.map((r) => r.source_finding_key));
      const rows: PromotableFinding[] = state.findings
        .filter((f) => f.project_id === projectId && f.kind === 'business_rule' && f.status !== 'dismissed')
        .map((f) => {
          const version = state.versions.find((v) => v.id === f.version_id)!;
          const process = state.processes.find((p) => p.id === version.process_id)!;
          return {
            versionId: f.version_id,
            findingKey: f.element_key,
            statement: f.statement,
            processId: process.id,
            processRef: process.ref_code,
            processName: process.name,
            versionNumber: version.version_number,
            promoted: promoted.has(f.element_key),
          };
        });
      return latestFindingPerKey(rows);
    },

    async promoteFinding(input) {
      const finding = state.findings.find((f) => f.version_id === input.versionId && f.element_key === input.findingKey);
      if (!finding) throw new AppError('Finding not found', 'P0002');
      requireRole(finding.project_id, EDITORS, 'You do not have permission to manage business rules.');
      if (finding.kind !== 'business_rule' || finding.status === 'dismissed') {
        throw new AppError('Only business-rule findings that are not dismissed can be promoted', 'PF422');
      }
      if (state.businessRules.some((r) => r.source_finding_key === finding.element_key)) {
        throw new AppError('This finding is already in the business rule register', 'PF409');
      }
      const version = state.versions.find((v) => v.id === input.versionId)!;
      const row = insertBusinessRule(state, finding.project_id, {
        title: input.title.trim() || finding.statement.slice(0, 200),
        statement: finding.statement,
        category: input.category,
        origin: finding.origin,
        activities: finding.related_node_keys.map((k) => ({ processId: version.process_id, nodeKey: k })),
        source: { versionId: input.versionId, findingKey: input.findingKey },
      });
      commit();
      return row.id;
    },

    async getVersionData(versionId) {
      const version = state.versions.find((v) => v.id === versionId);
      if (!version) throw new AppError('Process version not found', 'P0002');
      requireMember(version.project_id);
      return copy({
        dataRevision: version.data_revision,
        requirements: requirementsFromRows(
          state.activityFields.filter((f) => f.version_id === versionId),
          state.activityOutputs.filter((o) => o.version_id === versionId),
        ),
      });
    },

    async saveVersionData(payload) {
      const version = state.versions.find((v) => v.id === payload.p_version_id);
      if (!version) throw new AppError('Process version not found', 'P0002');
      requireRole(version.project_id, EDITORS, 'You do not have permission to edit this process');
      if (version.status !== 'draft') {
        throw new AppError(
          `Version ${version.version_number} is ${version.status} and cannot be changed; create a new draft instead`,
          'PF423',
        );
      }
      if (version.data_revision !== payload.p_expected_revision) {
        throw new AppError(
          'The inputs and outputs were saved in another tab since you opened them. Reload to see those changes.',
          'PF409',
        );
      }
      writeVersionData(state, version, copy(payload));
      commit();
      return version.data_revision;
    },

    async suggestFields({ versionId, nodeKeys }, signal) {
      const version = state.versions.find((v) => v.id === versionId);
      if (!version) throw new AppError('Process version not found.', 'not_found');
      requireRole(version.project_id, EDITORS, 'Only Business Analysts and Administrators can define data requirements.');
      if (version.status !== 'draft') {
        throw new AppError('This version is not a draft. Create a new draft to change its data requirements.', 'version_locked');
      }
      const process = state.processes.find((p) => p.id === version.process_id)!;
      const dictionary = state.fields.filter((f) => f.project_id === version.project_id).map(fieldFromRow);
      const businessRules = [
        ...state.findings
          .filter((f) => f.version_id === versionId && f.kind === 'business_rule' && f.status !== 'dismissed')
          .map((f) => f.statement),
        ...state.businessRules
          .filter((r) => r.project_id === version.project_id && r.status !== 'retired')
          .map((r) => r.statement),
      ];
      const { context, keyByActivityId } = buildSuggestionContext({
        processName: process.name,
        description: version.description,
        graph: versionGraph(versionId),
        actors: state.actors
          .filter((a) => a.project_id === version.project_id)
          .map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
        dictionary,
        businessRules: [...new Set(businessRules)],
        nodeKeys,
      });
      if (keyByActivityId.size === 0)
        throw new AppError('The process map has no activities to define data for. Create the map first.', 'no_activities');
      const prompt = buildFieldSuggestionPrompt(context);
      const ids = new Set(keyByActivityId.keys());
      const { value: suggestions, model } = await runStructured({
        ...prompt,
        schema: fieldSuggestionsJsonSchema(),
        parse: (raw) => parseFieldSuggestions(raw, ids),
        signal,
      });
      const current = requirementsFromRows(
        state.activityFields.filter((f) => f.version_id === versionId),
        state.activityOutputs.filter((o) => o.version_id === versionId),
      );
      return {
        runId: uuid(),
        model,
        proposal: suggestionsToProposal(suggestions, { keyByActivityId, dictionary, current }),
      };
    },

    async translateValidationRule({ fieldId, text }, signal) {
      const row = state.fields.find((f) => f.id === fieldId);
      if (!row) throw new AppError('Field not found.', 'not_found');
      requireRole(row.project_id, EDITORS, 'Only Business Analysts and Administrators can define validation rules.');
      const trimmed = text.trim();
      if (trimmed.length < 5) throw new AppError('Describe the validation logic first.');
      const dictionary = state.fields.filter((f) => f.project_id === row.project_id).map(fieldFromRow);
      const field = fieldFromRow(row);
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
        text: trimmed,
      });
      const { value: translation, model } = await runStructured({
        ...prompt,
        schema: ruleTranslationJsonSchema(),
        parse: parseRuleTranslation,
        signal,
      });
      return {
        runId: uuid(),
        model,
        proposal: translationToProposal(translation, dictionary),
      };
    },
  };
}
