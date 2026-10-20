import type {
  Actor,
  ActorKind,
  ProcessFinding,
  ProcessGraph,
  ProcessProposal,
  ProcessRow,
  ProcessType,
  ProcessVersionRow,
  ProjectRole,
  ProjectRow,
  ProposedActor,
  SaveDraftPayload,
} from '@productflow/domain';

/**
 * Everything the web app reads and writes. The production implementation
 * talks to Supabase and the ProductFlow API; the demo build swaps in an
 * in-browser implementation (see demo.ts) with the same behaviour.
 * Implementations throw AppError with the database error codes in errors.ts.
 */

export interface SessionInfo {
  userId: string;
  email: string;
  displayName: string;
}

export interface ProjectWithRole extends ProjectRow {
  role: ProjectRole;
}

export interface Member {
  userId: string;
  role: ProjectRole;
  displayName: string;
  email: string;
  createdAt: string;
}

export type VersionSummary = Pick<ProcessVersionRow, 'id' | 'version_number' | 'status' | 'updated_at' | 'approved_at'>;

export interface ProcessSummary extends ProcessRow {
  versions: VersionSummary[];
}

export interface ProcessDetail {
  process: ProcessRow;
  versions: ProcessVersionRow[];
}

export interface VersionContent {
  version: ProcessVersionRow;
  graph: ProcessGraph;
  findings: ProcessFinding[];
}

export interface CreateProcessInput {
  projectId: string;
  name: string;
  processType: ProcessType;
  owner: string;
  businessUnit: string;
  description: string;
}

export interface ProcessDetailsInput {
  name: string;
  processType: ProcessType;
  owner: string;
  businessUnit: string;
}

export interface AnalysisResponse {
  runId: string;
  model: string;
  proposal: ProcessProposal;
}

export interface AuthApi {
  getSession(): Promise<SessionInfo | null>;
  /** Calls back on every sign-in, sign-out and token refresh. Returns an unsubscribe function. */
  onChange(callback: (session: SessionInfo | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  /** Resolves `needsConfirmation` when the account must be confirmed by email first. */
  signUp(email: string, password: string, displayName: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
}

export interface Backend {
  readonly mode: 'live' | 'demo';
  auth: AuthApi;

  listMyProjects(userId: string): Promise<ProjectWithRole[]>;
  createProject(input: { key: string; name: string; description: string }): Promise<ProjectRow>;
  updateProject(input: { id: string; name: string; description: string }): Promise<void>;
  listMembers(projectId: string): Promise<Member[]>;
  addMember(projectId: string, email: string, role: ProjectRole): Promise<void>;
  updateMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<void>;
  removeMember(projectId: string, userId: string): Promise<void>;

  listProcesses(projectId: string): Promise<ProcessSummary[]>;
  createProcess(input: CreateProcessInput): Promise<{ process_id: string; version_id: string }>;
  getProcessDetail(processId: string): Promise<ProcessDetail | null>;
  updateProcessDetails(processId: string, input: ProcessDetailsInput): Promise<void>;
  getVersionContent(versionId: string): Promise<VersionContent>;
  saveDraft(payload: SaveDraftPayload): Promise<number>;
  approveVersion(versionId: string, revision: number): Promise<void>;
  createDraftFromVersion(versionId: string): Promise<string>;

  listActors(projectId: string): Promise<Actor[]>;
  createActor(projectId: string, input: { name: string; kind: ActorKind }): Promise<Actor>;
  /** Creates any actors that do not exist yet and returns the project's matching actors. */
  ensureActors(projectId: string, actors: ProposedActor[]): Promise<Actor[]>;

  analyseProcess(args: { versionId: string; description: string }, signal?: AbortSignal): Promise<AnalysisResponse>;
}
