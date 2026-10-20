import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  businessRuleFromRow,
  columnFromRow,
  DomainError,
  fieldFromRow,
  ruleFromRow,
  type ActivityFieldRow,
  type ActorRow,
  type AiGateway,
  type BusinessRuleActivityRow,
  type BusinessRuleRow,
  type DeliveryKind,
  type DeliverySettings,
  type DeliveryStore,
  type FieldDefinitionRow,
  type PhysicalColumnRow,
  type ProcessEdgeRow,
  type ProcessNodeRow,
  type ProcessRow,
  type ProcessVersionRow,
  type ProjectContext,
  type ProjectRole,
  type ValidationRuleRow,
} from '@productflow/domain';
import type { StructuredRunner } from './ai/analyser';

/**
 * Storage for the delivery service, using the Supabase service role. The
 * service has already checked the caller's project role before any write;
 * the database denies these writes to signed-in users directly.
 */

const TABLES: Record<DeliveryKind, string> = {
  stories: 'stories',
  sprints: 'sprints',
  sprintItems: 'sprint_items',
  scenarios: 'business_scenarios',
  executions: 'test_executions',
  defects: 'defects',
  events: 'delivery_events',
  insights: 'ai_insights',
};

const ORDER: Partial<Record<DeliveryKind, string>> = {
  stories: 'ref_code',
  sprints: 'start_date',
  scenarios: 'ref_code',
  executions: 'started_at',
  defects: 'ref_code',
  events: 'created_at',
  insights: 'created_at',
  sprintItems: 'added_at',
};

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Converts a record's top-level keys to column names. Nested JSON (lists, links) is stored as it is. */
export function toColumns(record: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [snake(k), v]));
}

export function fromColumns<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v])) as T;
}

function dbError(error: { code?: string; message: string }): never {
  const code = error.code ?? '';
  if (['PF409', 'PF422', 'PF423', '42501', 'P0002'].includes(code)) throw new DomainError(error.message, code as 'PF409');
  if (code === '23505') throw new DomainError('That record already exists.', 'PF409');
  if (code === '23514' || code === '22P02') throw new DomainError('Some values are not in the expected format.', 'PF422');
  if (code === '23503') throw new DomainError('A linked record does not exist.', 'PF422');
  throw new Error(`Database error: ${error.message}`);
}

async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) dbError(error);
  return (data ?? []) as T[];
}

export interface AiRunRecord {
  projectId: string;
  userId: string;
  task: string;
  subjectId: string;
  model: string;
  promptVersion: string;
  succeeded: boolean;
  input: string;
  response: unknown;
  error: string | null;
  usage: unknown;
}

export interface ApiDeliveryStore extends DeliveryStore {
  recordAiRun(run: AiRunRecord): Promise<string>;
}

export function createServiceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function createSupabaseDeliveryStore(db: SupabaseClient): ApiDeliveryStore {
  return {
    async memberRole(projectId, userId) {
      const { data, error } = await db
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) dbError(error);
      return (data?.role as ProjectRole | undefined) ?? null;
    },

    async context(projectId): Promise<ProjectContext> {
      const byProject = (table: string) => rows<Record<string, unknown>>(db.from(table).select('*').eq('project_id', projectId));
      const [
        project,
        processes,
        versions,
        nodes,
        edges,
        actors,
        activityFields,
        fields,
        validationRules,
        businessRules,
        ruleLinks,
        columns,
        mappings,
        members,
      ] = await Promise.all([
        db.from('projects').select('key').eq('id', projectId).single(),
        byProject('processes'),
        byProject('process_versions'),
        byProject('process_nodes'),
        byProject('process_edges'),
        byProject('actors'),
        byProject('activity_fields'),
        byProject('field_definitions'),
        byProject('validation_rules'),
        byProject('business_rules'),
        byProject('business_rule_activities'),
        byProject('physical_columns'),
        byProject('field_column_mappings'),
        rows<{ user_id: string; role: ProjectRole; profiles: { display_name: string } | { display_name: string }[] | null }>(
          db
            .from('project_members')
            .select('user_id, role, profiles!project_members_user_id_fkey(display_name)')
            .eq('project_id', projectId),
        ),
      ]);
      if (project.error) dbError(project.error);
      return {
        projectId,
        projectKey: (project.data as { key: string }).key,
        processes: processes as unknown as ProcessRow[],
        versions: versions as unknown as ProcessVersionRow[],
        nodes: nodes as unknown as ProcessNodeRow[],
        edges: edges as unknown as ProcessEdgeRow[],
        actors: (actors as unknown as ActorRow[]).map((a) => ({ id: a.id, name: a.name })),
        activityFields: activityFields as unknown as ActivityFieldRow[],
        fields: (fields as unknown as FieldDefinitionRow[]).map(fieldFromRow),
        validationRules: (validationRules as unknown as ValidationRuleRow[]).map(ruleFromRow),
        businessRules: (businessRules as unknown as BusinessRuleRow[]).map((r) =>
          businessRuleFromRow(r, ruleLinks as unknown as BusinessRuleActivityRow[]),
        ),
        columns: (columns as unknown as PhysicalColumnRow[]).map(columnFromRow),
        columnMappings: (mappings as { field_id: string; column_id: string; transformation: string }[]).map((m) => ({
          fieldId: m.field_id,
          columnId: m.column_id,
          transformation: m.transformation,
        })),
        members: members.map((m) => {
          const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
          return { userId: m.user_id, role: m.role, displayName: profile?.display_name ?? '' };
        }),
      };
    },

    async list(kind, projectId) {
      const data = await rows<Record<string, unknown>>(
        db
          .from(TABLES[kind])
          .select('*')
          .eq('project_id', projectId)
          .order(ORDER[kind] ?? 'id'),
      );
      return data.map((r) => fromColumns(r));
    },

    async get(kind, id) {
      const { data, error } = await db.from(TABLES[kind]).select('*').eq('id', id).maybeSingle();
      if (error) dbError(error);
      return data ? fromColumns(data as Record<string, unknown>) : null;
    },

    async insert(kind, row) {
      const { error } = await db.from(TABLES[kind]).insert(toColumns(row));
      if (error) dbError(error);
    },

    async update(kind, row, expectedRevision) {
      let query = db.from(TABLES[kind]).update(toColumns(row)).eq('id', row.id);
      if (expectedRevision !== undefined) query = query.eq('revision', expectedRevision);
      const data = await rows(query.select('id'));
      return data.length === 1;
    },

    async remove(kind, id) {
      const { error } = await db.from(TABLES[kind]).delete().eq('id', id);
      if (error) dbError(error);
    },

    async nextRef(projectId, prefix) {
      const { data, error } = await db.rpc('next_ref', { p_project_id: projectId, p_prefix: prefix });
      if (error) dbError(error);
      return data as string;
    },

    async processProject(processId) {
      const { data, error } = await db.from('processes').select('project_id').eq('id', processId).maybeSingle();
      if (error) dbError(error);
      return (data?.project_id as string | undefined) ?? null;
    },

    async getSettings(projectId) {
      const { data, error } = await db.from('delivery_settings').select('*').eq('project_id', projectId).maybeSingle();
      if (error) dbError(error);
      return data ? fromColumns<DeliverySettings>(data as Record<string, unknown>) : null;
    },

    async saveSettings(settings, expectedRevision) {
      if (expectedRevision === 0) {
        const { error } = await db.from('delivery_settings').insert(toColumns(settings));
        if (error?.code === '23505') return false;
        if (error) dbError(error);
        return true;
      }
      const data = await rows(
        db
          .from('delivery_settings')
          .update(toColumns(settings))
          .eq('project_id', settings.projectId)
          .eq('revision', expectedRevision)
          .select('project_id'),
      );
      return data.length === 1;
    },

    async recordAiRun(run) {
      const { data, error } = await db
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
          created_by: run.userId,
        })
        .select('id')
        .single();
      if (error) dbError(error);
      return (data as { id: string }).id;
    },
  };
}

/** Runs delivery AI tasks on Claude through the structured runner, recording every run. */
export function createAiGateway(
  runner: StructuredRunner,
  record: (run: AiRunRecord) => Promise<string>,
  userId: string,
): AiGateway {
  return {
    async run(task, input, meta) {
      const user = task.user(input);
      const outcome = await runner.run({
        system: task.system,
        user,
        schema: task.schema(),
        parse: (raw) => task.parse(raw, input),
        promptVersion: task.promptVersion,
      });
      const runId = await record({
        projectId: meta.projectId,
        userId,
        task: task.name,
        subjectId: meta.subjectId,
        model: outcome.model,
        promptVersion: outcome.promptVersion,
        succeeded: outcome.ok,
        input: user,
        response: outcome.ok ? outcome.value : outcome.rawOutput,
        error: outcome.ok ? null : `${outcome.kind}: ${outcome.message}`,
        usage: outcome.usage,
      });
      if (!outcome.ok) throw new DomainError(outcome.message, `ai_${outcome.kind}`);
      return { value: outcome.value, model: outcome.model, runId };
    },
  };
}
