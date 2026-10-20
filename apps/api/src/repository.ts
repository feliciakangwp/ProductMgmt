import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  fieldFromRow,
  findingFromRow,
  graphFromRows,
  requirementsFromRows,
  type Actor,
  type ActivityFieldRow,
  type ActivityOutputRow,
  type ActorRow,
  type FieldDefinition,
  type FieldDefinitionRow,
  type ProcessEdgeRow,
  type ProcessFindingRow,
  type ProcessGraph,
  type ProcessNodeRow,
  type ProjectRole,
  type VersionDataRequirements,
  type VersionStatus,
} from '@productflow/domain';
import { AppError } from './errors';

export interface VersionContext {
  versionId: string;
  processId: string;
  projectId: string;
  processName: string;
  processType: string;
  status: VersionStatus;
  role: ProjectRole | null;
}

export interface AnalysisRunRecord {
  projectId: string;
  processId: string;
  versionId: string;
  model: string;
  promptVersion: string;
  succeeded: boolean;
  descriptionSnapshot: string;
  response: unknown;
  error: string | null;
  usage: unknown;
}

/** What the field-suggestion task needs to know about a process version. */
export interface ProcessDataContext {
  description: string;
  graph: ProcessGraph;
  actors: Actor[];
  dictionary: FieldDefinition[];
  /** Business rules from the version's findings and the project register, as sentences. */
  businessRules: string[];
  requirements: VersionDataRequirements;
}

export interface FieldContext {
  projectId: string;
  role: ProjectRole | null;
  field: FieldDefinition;
  dictionary: FieldDefinition[];
}

export interface AiTaskRunRecord {
  projectId: string;
  task: 'field_suggestions' | 'rule_translation';
  subjectId: string;
  model: string;
  promptVersion: string;
  succeeded: boolean;
  input: string;
  response: unknown;
  error: string | null;
  usage: unknown;
}

/** Data access on behalf of one signed-in user. Every query runs under that user's RLS policies. */
export interface UserRepository {
  readonly userId: string;
  getVersionContext(versionId: string): Promise<VersionContext | null>;
  recordAnalysisRun(run: AnalysisRunRecord): Promise<string>;
  getProcessDataContext(context: VersionContext): Promise<ProcessDataContext>;
  getFieldContext(fieldId: string): Promise<FieldContext | null>;
  recordAiTaskRun(run: AiTaskRunRecord): Promise<string>;
}

export interface Authenticator {
  /** Returns a repository scoped to the token's user, or null if the token is not valid. */
  authenticate(accessToken: string): Promise<UserRepository | null>;
}

export function createSupabaseAuthenticator(url: string, anonKey: string): Authenticator {
  const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async authenticate(accessToken) {
      const { data, error } = await verifier.auth.getUser(accessToken);
      if (error || !data.user) return null;
      // A client that sends the user's own JWT, so RLS applies exactly as in the browser.
      const db = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
      return new SupabaseUserRepository(db, data.user.id);
    },
  };
}

class SupabaseUserRepository implements UserRepository {
  constructor(
    private readonly db: SupabaseClient,
    readonly userId: string,
  ) {}

  async getVersionContext(versionId: string): Promise<VersionContext | null> {
    const { data: version, error } = await this.db
      .from('process_versions')
      .select('id, status, process_id, project_id, processes(name, process_type)')
      .eq('id', versionId)
      .maybeSingle();
    if (error) throw new AppError(500, 'database_error', error.message);
    if (!version) return null;

    const { data: member, error: memberError } = await this.db
      .from('project_members')
      .select('role')
      .eq('project_id', version.project_id)
      .eq('user_id', this.userId)
      .maybeSingle();
    if (memberError) throw new AppError(500, 'database_error', memberError.message);

    const process = (Array.isArray(version.processes) ? version.processes[0] : version.processes) as {
      name: string;
      process_type: string;
    } | null;
    return {
      versionId: version.id,
      processId: version.process_id,
      projectId: version.project_id,
      processName: process?.name ?? '',
      processType: process?.process_type ?? 'as_is',
      status: version.status,
      role: (member?.role as ProjectRole | undefined) ?? null,
    };
  }

  private async role(projectId: string): Promise<ProjectRole | null> {
    const { data, error } = await this.db
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', this.userId)
      .maybeSingle();
    if (error) throw new AppError(500, 'database_error', error.message);
    return (data?.role as ProjectRole | undefined) ?? null;
  }

  private async dictionary(projectId: string): Promise<FieldDefinition[]> {
    const { data, error } = await this.db.from('field_definitions').select('*').eq('project_id', projectId).order('ref_code');
    if (error) throw new AppError(500, 'database_error', error.message);
    return ((data ?? []) as FieldDefinitionRow[]).map(fieldFromRow);
  }

  async getProcessDataContext(context: VersionContext): Promise<ProcessDataContext> {
    const v = context.versionId;
    const [version, nodes, edges, findings, actors, rules, fields, outputs, dictionary] = await Promise.all([
      this.db.from('process_versions').select('description').eq('id', v).single(),
      this.db.from('process_nodes').select('*').eq('version_id', v),
      this.db.from('process_edges').select('*').eq('version_id', v),
      this.db.from('process_findings').select('*').eq('version_id', v),
      this.db.from('actors').select('*').eq('project_id', context.projectId),
      this.db.from('business_rules').select('statement, status').eq('project_id', context.projectId).neq('status', 'retired'),
      this.db.from('activity_fields').select('*').eq('version_id', v),
      this.db.from('activity_outputs').select('*').eq('version_id', v),
      this.dictionary(context.projectId),
    ]);
    for (const result of [version, nodes, edges, findings, actors, rules, fields, outputs]) {
      if (result.error) throw new AppError(500, 'database_error', result.error.message);
    }
    const ruleTexts = [
      ...((findings.data ?? []) as ProcessFindingRow[])
        .map(findingFromRow)
        .filter((f) => f.kind === 'business_rule' && f.status !== 'dismissed')
        .map((f) => f.statement),
      ...((rules.data ?? []) as { statement: string }[]).map((r) => r.statement),
    ];
    return {
      description: (version.data as { description: string }).description,
      graph: graphFromRows((nodes.data ?? []) as ProcessNodeRow[], (edges.data ?? []) as ProcessEdgeRow[]),
      actors: ((actors.data ?? []) as ActorRow[]).map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
      dictionary,
      businessRules: [...new Set(ruleTexts)],
      requirements: requirementsFromRows((fields.data ?? []) as ActivityFieldRow[], (outputs.data ?? []) as ActivityOutputRow[]),
    };
  }

  async getFieldContext(fieldId: string): Promise<FieldContext | null> {
    const { data, error } = await this.db.from('field_definitions').select('*').eq('id', fieldId).maybeSingle();
    if (error) throw new AppError(500, 'database_error', error.message);
    if (!data) return null;
    const row = data as FieldDefinitionRow;
    const [role, dictionary] = await Promise.all([this.role(row.project_id), this.dictionary(row.project_id)]);
    return { projectId: row.project_id, role, field: fieldFromRow(row), dictionary };
  }

  async recordAiTaskRun(run: AiTaskRunRecord): Promise<string> {
    const { data, error } = await this.db
      .from('ai_task_runs')
      .insert({
        project_id: run.projectId,
        task: run.task,
        subject_id: run.subjectId,
        model: run.model,
        prompt_version: run.promptVersion,
        succeeded: run.succeeded,
        input: run.input,
        response: run.response,
        error: run.error,
        usage: run.usage,
      })
      .select('id')
      .single();
    if (error) throw new AppError(500, 'database_error', `Could not record the AI run: ${error.message}`);
    return data.id as string;
  }

  async recordAnalysisRun(run: AnalysisRunRecord): Promise<string> {
    const { data, error } = await this.db
      .from('process_analysis_runs')
      .insert({
        project_id: run.projectId,
        process_id: run.processId,
        version_id: run.versionId,
        model: run.model,
        prompt_version: run.promptVersion,
        succeeded: run.succeeded,
        description_snapshot: run.descriptionSnapshot,
        response: run.response,
        error: run.error,
        usage: run.usage,
      })
      .select('id')
      .single();
    if (error) throw new AppError(500, 'database_error', `Could not record the analysis run: ${error.message}`);
    return data.id as string;
  }
}
