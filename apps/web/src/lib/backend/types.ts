import type {
  Actor,
  ActorKind,
  BusinessRule,
  BusinessRuleCategory,
  DataProposal,
  FieldColumnMapping,
  FieldDefinition,
  FindingRef,
  PhysicalColumn,
  RuleTranslationProposal,
  SaveDataPayload,
  ValidationRule,
  VersionDataRequirements,
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

export type NewFieldInput = Pick<
  FieldDefinition,
  'name' | 'description' | 'dataType' | 'allowedValues' | 'defaultValue' | 'source' | 'sourceDetail' | 'origin'
> & { status?: FieldDefinition['status'] };

export type ValidationRuleInput = Omit<ValidationRule, 'id' | 'refCode'>;

export type BusinessRuleInput = Pick<BusinessRule, 'title' | 'statement' | 'category' | 'origin' | 'activities'>;

/** Where a dictionary field is used: one activity in one process version. */
export interface FieldUsage {
  fieldId: string;
  direction: 'input' | 'output';
  processId: string;
  processRef: string;
  processName: string;
  versionId: string;
  versionNumber: number;
  versionStatus: ProcessVersionRow['status'];
  nodeKey: string;
  nodeRef: string | null;
  nodeLabel: string;
}

/** A business-rule finding from a process that can be promoted into the rule register. */
export interface PromotableFinding extends FindingRef {
  processId: string;
  processRef: string;
  processName: string;
  versionNumber: number;
  statement: string;
  promoted: boolean;
}

export interface VersionData {
  dataRevision: number;
  requirements: VersionDataRequirements;
}

export interface DataSuggestionResponse {
  runId: string;
  model: string;
  proposal: DataProposal;
}

export interface RuleTranslationResponse {
  runId: string;
  model: string;
  proposal: RuleTranslationProposal;
}

/** Extra controls only the in-browser demo offers. */
export interface DemoControls {
  /** Discards everything the viewer changed and restores the example data. */
  reset(): void;
  /** Lets the viewer try the app as another project role. */
  setMyRole(projectId: string, role: ProjectRole): void;
  myRole(projectId: string): ProjectRole | null;
}

export interface Backend {
  readonly mode: 'live' | 'demo';
  auth: AuthApi;
  /** Present only in the demo build. */
  readonly demo?: DemoControls;

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

  // Phase 2: data requirements
  listFields(projectId: string): Promise<FieldDefinition[]>;
  createFields(projectId: string, fields: NewFieldInput[]): Promise<FieldDefinition[]>;
  /** Fails with PF409 when the field changed since `field.revision` was read. */
  updateField(field: FieldDefinition): Promise<FieldDefinition>;
  deleteField(fieldId: string): Promise<void>;
  listFieldUsages(projectId: string): Promise<FieldUsage[]>;

  listValidationRules(projectId: string): Promise<ValidationRule[]>;
  createValidationRule(projectId: string, input: ValidationRuleInput): Promise<ValidationRule>;
  updateValidationRule(rule: ValidationRule): Promise<ValidationRule>;
  deleteValidationRule(ruleId: string): Promise<void>;

  listPhysicalColumns(projectId: string): Promise<PhysicalColumn[]>;
  createPhysicalColumn(projectId: string, input: Omit<PhysicalColumn, 'id'>): Promise<PhysicalColumn>;
  deletePhysicalColumn(columnId: string): Promise<void>;
  listColumnMappings(projectId: string): Promise<FieldColumnMapping[]>;
  addColumnMapping(projectId: string, mapping: FieldColumnMapping): Promise<void>;
  removeColumnMapping(fieldId: string, columnId: string): Promise<void>;

  listBusinessRules(projectId: string): Promise<BusinessRule[]>;
  createBusinessRule(projectId: string, input: BusinessRuleInput): Promise<BusinessRule>;
  /** Saves wording, category, status and activity links. Fails with PF409 on a stale revision. */
  updateBusinessRule(rule: BusinessRule): Promise<BusinessRule>;
  deleteBusinessRule(ruleId: string): Promise<void>;
  listPromotableFindings(projectId: string): Promise<PromotableFinding[]>;
  promoteFinding(input: FindingRef & { title: string; category: BusinessRuleCategory }): Promise<string>;

  getVersionData(versionId: string): Promise<VersionData>;
  saveVersionData(payload: SaveDataPayload): Promise<number>;

  suggestFields(args: { versionId: string; nodeKeys?: string[] }, signal?: AbortSignal): Promise<DataSuggestionResponse>;
  translateValidationRule(args: { fieldId: string; text: string }, signal?: AbortSignal): Promise<RuleTranslationResponse>;
}
