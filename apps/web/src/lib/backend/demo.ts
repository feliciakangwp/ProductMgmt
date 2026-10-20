import {
  analysisToProposal,
  buildRetryMessage,
  buildUserMessage,
  findingFromRow,
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
import { DEBT_WRITE_OFF_ANALYSIS, DEBT_WRITE_OFF_DESCRIPTION } from '@productflow/domain/testing';
import { AppError } from '../errors';
import { safeStorage } from '../storage';
import type { Backend, DemoControls, Member, ProcessSummary, SessionInfo } from './types';

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

interface DemoState {
  schema: 1;
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
}

const STORAGE_KEY = 'productflow-demo:v1';
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
    schema: 1,
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
      if (parsed.schema === 1) return parsed;
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
  return draft.id;
}

function versionGraph(versionId: string) {
  return graphFromRows(
    state.nodes.filter((n) => n.version_id === versionId),
    state.edges.filter((e) => e.version_id === versionId),
  );
}

// ---------------------------------------------------------------------------
// Claude, through the artifact runtime
// ---------------------------------------------------------------------------

interface SampleError {
  code: string;
  message: string;
}
type SampleJson = (
  input: string,
  options?: { modelTier?: 'default' | 'complex' | 'quick'; signal?: AbortSignal },
) => Promise<unknown>;
interface ClaudeRuntime {
  use(name: 'sample'): Promise<{ json: SampleJson } | null>;
}

async function getSample(): Promise<SampleJson> {
  const runtime = (globalThis as { claude?: ClaudeRuntime }).claude;
  const sample = runtime ? await runtime.use('sample') : null;
  if (!sample) {
    throw new AppError(
      'AI analysis needs Claude, which is only available when this demo is opened from its claude.ai link while signed in.',
      'ai_unavailable',
    );
  }
  return sample.json;
}

function sampleErrorMessage(error: SampleError): string {
  switch (error.code) {
    case 'not_granted':
    case 'sampling_disabled':
      return 'This page is not allowed to use Claude. Allow it in the artifact permissions to run the analysis.';
    case 'rate_limited':
      return 'Claude is busy or your usage limit was reached. Wait a moment and try again.';
    case 'session_expired':
      return 'Your claude.ai session expired. Sign in again and reload the page.';
    case 'refused':
      return 'Claude declined to analyse this description. Review the text and try again.';
    case 'prompt_too_large':
      return 'The description is too long to analyse in one pass. Split it into smaller processes.';
    case 'invalid_json':
      return 'Claude returned a reply that was not a process model. Try again.';
    default:
      return 'Claude could not complete the analysis. Try again in a moment.';
  }
}

async function analyseWithClaude(
  request: { description: string; processName: string; processType: string },
  signal?: AbortSignal,
): Promise<ProcessAnalysis> {
  const json = await getSample();
  const schema = JSON.stringify(processAnalysisJsonSchema());
  const format = `\n\nReply with only a JSON object that matches this JSON schema exactly (no other text):\n${schema}`;
  const original = buildUserMessage(request);
  let message = original;
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let value: unknown;
    try {
      value = await json(`${SYSTEM_PROMPT}\n\n${message}${format}`, { modelTier: 'default', signal });
    } catch (err) {
      const error = err as SampleError;
      if (error?.code === 'cancelled') throw new AppError('Analysis cancelled.', 'cancelled');
      throw new AppError(sampleErrorMessage(error), `analysis_${error?.code ?? 'error'}`);
    }
    const raw = JSON.stringify(value);
    const parsed = parseProcessAnalysis(raw);
    if (parsed.ok) return parsed.value;
    lastErrors = parsed.errors;
    message = buildRetryMessage({ original, invalidOutput: raw, errors: parsed.errors });
  }
  throw new AppError(
    `Claude returned a process model that failed validation (${lastErrors.slice(0, 3).join('; ')}). Try again.`,
    'analysis_invalid_output',
  );
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

const listeners = new Set<(session: SessionInfo | null) => void>();
const demoUser = () => state.users.find((u) => u.userId === DEMO_USER_ID)!;

const demoControls: DemoControls = {
  reset() {
    state = seed();
    commit();
  },
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
      const analysis = await analyseWithClaude(
        { description: text, processName: process.name, processType: process.process_type },
        signal,
      );
      const runId = uuid();
      state.runs.push({ id: runId, version_id: versionId, accepted_at: null });
      commit();
      return { runId, model: 'Claude (your claude.ai account)', proposal: analysisToProposal(analysis) };
    },
  };
}
