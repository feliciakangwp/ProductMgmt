import {
  businessRuleFromRow,
  columnFromRow,
  fieldFromRow,
  findingFromRow,
  graphFromRows,
  requirementsFromRows,
  ruleFromRow,
  type ActivityFieldRow,
  type ActivityOutputRow,
  type ActorRow,
  type BusinessRule,
  type BusinessRuleActivityRow,
  type BusinessRuleRow,
  type FieldDefinitionRow,
  type PhysicalColumnRow,
  type ValidationRuleRow,
  type ProcessEdgeRow,
  type ProcessFindingRow,
  type ProcessNodeRow,
  type ProcessRow,
  type ProcessVersionRow,
  type ProjectRole,
  type ProjectRow,
  type DeliveryClient,
} from '@productflow/domain';
import type { Session } from '@supabase/supabase-js';
import { env } from '../env';
import { AppError, fromPostgrest } from '../errors';
import { supabase } from '../supabase';
import type {
  AnalysisResponse,
  Backend,
  DataSuggestionResponse,
  FieldUsage,
  Member,
  ProcessSummary,
  ProjectWithRole,
  PromotableFinding,
  RuleTranslationResponse,
  SessionInfo,
  VersionSummary,
} from './types';
import { latestFindingPerKey } from './helpers';

function toSession(session: Session | null): SessionInfo | null {
  if (!session) return null;
  const user = session.user;
  return {
    userId: user.id,
    email: user.email ?? '',
    displayName: (user.user_metadata?.display_name as string | undefined) || user.email || '',
  };
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AppError('Your session has expired. Sign in again.', 'unauthenticated', 401);

  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new AppError('Could not reach the ProductFlow API. Is it running?', 'network_error');
  }

  const payload = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!response.ok) {
    const error = payload?.error;
    throw new AppError(error?.message ?? `Request failed (${response.status}).`, error?.code ?? null, response.status);
  }
  return payload as T;
}

/** Production backend: Supabase (with row level security) plus the ProductFlow API. */
export function createBackend(): Backend {
  const delivery = new Proxy({} as DeliveryClient, {
    get: (_target, op: string) => async (input: unknown, signal?: AbortSignal) =>
      (await postJson<{ result: unknown }>(`/api/delivery/${op}`, input, signal)).result,
  });

  return {
    mode: 'live',
    delivery,

    auth: {
      async getSession() {
        const { data } = await supabase.auth.getSession();
        return toSession(data.session);
      },
      onChange(callback) {
        const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(toSession(session)));
        return () => data.subscription.unsubscribe();
      },
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new AppError(error.message, error.code ?? null);
      },
      async signUp(email, password, displayName) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // The confirmation email links back to this site, whichever address it is served from.
          options: { data: { display_name: displayName }, emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw new AppError(error.message, error.code ?? null);
        return { needsConfirmation: !data.session };
      },
      async signOut() {
        await supabase.auth.signOut();
      },
      async requestPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw new AppError(error.message, error.code ?? null);
      },
      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw new AppError(error.message, error.code ?? null);
      },
    },

    async listMyProjects(userId) {
      const { data, error } = await supabase.from('project_members').select('role, projects(*)').eq('user_id', userId);
      if (error) throw fromPostgrest(error);
      return (data ?? [])
        .map((row) => {
          const project = one(row.projects as ProjectRow | ProjectRow[] | null);
          return project ? { ...project, role: row.role as ProjectRole } : null;
        })
        .filter((p): p is ProjectWithRole => p !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async createProject(input) {
      const { data, error } = await supabase.rpc('create_project', {
        p_key: input.key,
        p_name: input.name,
        p_description: input.description,
      });
      if (error) throw fromPostgrest(error);
      return data as ProjectRow;
    },

    async updateProject(input) {
      const { error, count } = await supabase
        .from('projects')
        .update({ name: input.name, description: input.description }, { count: 'exact' })
        .eq('id', input.id);
      if (error) throw fromPostgrest(error);
      if (count === 0) throw new AppError('Only project administrators can change project details.', '42501');
    },

    async listMembers(projectId) {
      const { data, error } = await supabase
        .from('project_members')
        .select('user_id, role, created_at, profiles!project_members_user_id_fkey(display_name, email)')
        .eq('project_id', projectId)
        .order('created_at');
      if (error) throw fromPostgrest(error);
      return (data ?? []).map((row): Member => {
        const profile = one(row.profiles as unknown as { display_name: string; email: string } | null);
        return {
          userId: row.user_id as string,
          role: row.role as ProjectRole,
          createdAt: row.created_at as string,
          displayName: profile?.display_name ?? 'Unknown user',
          email: profile?.email ?? '',
        };
      });
    },

    async addMember(projectId, email, role) {
      const { error } = await supabase.rpc('add_project_member', { p_project_id: projectId, p_email: email, p_role: role });
      if (error) throw fromPostgrest(error);
    },

    async updateMemberRole(projectId, userId, role) {
      const { error } = await supabase.rpc('update_member_role', { p_project_id: projectId, p_user_id: userId, p_role: role });
      if (error) throw fromPostgrest(error);
    },

    async removeMember(projectId, userId) {
      const { error } = await supabase.rpc('remove_project_member', { p_project_id: projectId, p_user_id: userId });
      if (error) throw fromPostgrest(error);
    },

    async listProcesses(projectId) {
      const { data, error } = await supabase
        .from('processes')
        .select('*, process_versions(id, version_number, status, updated_at, approved_at)')
        .eq('project_id', projectId)
        .order('ref_code');
      if (error) throw fromPostgrest(error);
      return (data ?? []).map(({ process_versions, ...row }): ProcessSummary => ({
        ...(row as ProcessRow),
        versions: ((process_versions ?? []) as VersionSummary[]).sort((a, b) => b.version_number - a.version_number),
      }));
    },

    async createProcess(input) {
      const { data, error } = await supabase.rpc('create_process', {
        p_project_id: input.projectId,
        p_name: input.name,
        p_process_type: input.processType,
        p_owner: input.owner,
        p_business_unit: input.businessUnit,
        p_description: input.description,
      });
      if (error) throw fromPostgrest(error);
      return data as { process_id: string; version_id: string };
    },

    async getProcessDetail(processId) {
      const [process, versions] = await Promise.all([
        supabase.from('processes').select('*').eq('id', processId).maybeSingle(),
        supabase.from('process_versions').select('*').eq('process_id', processId).order('version_number', { ascending: false }),
      ]);
      if (process.error) throw fromPostgrest(process.error);
      if (versions.error) throw fromPostgrest(versions.error);
      if (!process.data) return null;
      return { process: process.data as ProcessRow, versions: (versions.data ?? []) as ProcessVersionRow[] };
    },

    async updateProcessDetails(processId, input) {
      const { error, count } = await supabase
        .from('processes')
        .update(
          {
            name: input.name.trim(),
            process_type: input.processType,
            owner: input.owner.trim(),
            business_unit: input.businessUnit.trim(),
          },
          { count: 'exact' },
        )
        .eq('id', processId);
      if (error) throw fromPostgrest(error);
      if (count === 0) throw new AppError('You do not have permission to edit this process.', '42501');
    },

    async getVersionContent(versionId) {
      const [version, nodes, edges, findings] = await Promise.all([
        supabase.from('process_versions').select('*').eq('id', versionId).single(),
        supabase.from('process_nodes').select('*').eq('version_id', versionId).order('created_at'),
        supabase.from('process_edges').select('*').eq('version_id', versionId).order('created_at'),
        supabase.from('process_findings').select('*').eq('version_id', versionId).order('created_at'),
      ]);
      for (const result of [version, nodes, edges, findings]) {
        if (result.error) throw fromPostgrest(result.error);
      }
      return {
        version: version.data as ProcessVersionRow,
        graph: graphFromRows((nodes.data ?? []) as ProcessNodeRow[], (edges.data ?? []) as ProcessEdgeRow[]),
        findings: ((findings.data ?? []) as ProcessFindingRow[]).map(findingFromRow),
      };
    },

    async saveDraft(payload) {
      const { data, error } = await supabase.rpc('save_process_draft', payload);
      if (error) throw fromPostgrest(error);
      return data as number;
    },

    async approveVersion(versionId, revision) {
      const { error } = await supabase.rpc('approve_process_version', {
        p_version_id: versionId,
        p_expected_revision: revision,
      });
      if (error) throw fromPostgrest(error);
    },

    async createDraftFromVersion(versionId) {
      const { data, error } = await supabase.rpc('create_draft_from_version', { p_version_id: versionId });
      if (error) throw fromPostgrest(error);
      return data as string;
    },

    async listActors(projectId) {
      const { data, error } = await supabase.from('actors').select('*').eq('project_id', projectId).order('name');
      if (error) throw fromPostgrest(error);
      return ((data ?? []) as ActorRow[]).map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
    },

    async createActor(projectId, input) {
      const { data, error } = await supabase
        .from('actors')
        .insert({ project_id: projectId, name: input.name.trim(), kind: input.kind })
        .select('*')
        .single();
      if (error) throw fromPostgrest(error);
      const row = data as ActorRow;
      return { id: row.id, name: row.name, kind: row.kind };
    },

    async ensureActors(projectId, actors) {
      if (actors.length === 0) return [];
      const { data, error } = await supabase.rpc('ensure_actors', { p_project_id: projectId, p_actors: actors });
      if (error) throw fromPostgrest(error);
      return ((data ?? []) as ActorRow[]).map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
    },

    analyseProcess(args, signal) {
      return postJson<AnalysisResponse>('/api/process-analysis', args, signal);
    },

    // -------------------------------------------------------------------
    // Phase 2: data requirements
    // -------------------------------------------------------------------

    async listFields(projectId) {
      const { data, error } = await supabase.from('field_definitions').select('*').eq('project_id', projectId).order('ref_code');
      if (error) throw fromPostgrest(error);
      return ((data ?? []) as FieldDefinitionRow[]).map(fieldFromRow);
    },

    async createFields(projectId, fields) {
      if (fields.length === 0) return [];
      const { data, error } = await supabase
        .from('field_definitions')
        .insert(
          fields.map((f) => ({
            project_id: projectId,
            name: f.name.trim(),
            description: f.description,
            data_type: f.dataType,
            allowed_values: f.allowedValues,
            default_value: f.defaultValue,
            source: f.source,
            source_detail: f.sourceDetail,
            status: f.status ?? 'draft',
            origin: f.origin,
          })),
        )
        .select('*');
      if (error) throw fromPostgrest(error);
      // Keep the caller's order so results line up with the inputs.
      const rows = ((data ?? []) as FieldDefinitionRow[]).map(fieldFromRow);
      return fields.map((f) => rows.find((r) => r.name === f.name.trim())!).filter(Boolean);
    },

    async updateField(field) {
      const { data, error } = await supabase
        .from('field_definitions')
        .update({
          name: field.name.trim(),
          description: field.description,
          data_type: field.dataType,
          allowed_values: field.allowedValues,
          default_value: field.defaultValue,
          source: field.source,
          source_detail: field.sourceDetail,
          status: field.status,
        })
        .eq('id', field.id)
        .eq('revision', field.revision)
        .select('*')
        .maybeSingle();
      if (error) throw fromPostgrest(error);
      if (!data)
        throw new AppError(
          `${field.refCode} was changed by someone else since you opened it. Reload to see their changes.`,
          'PF409',
        );
      return fieldFromRow(data as FieldDefinitionRow);
    },

    async deleteField(fieldId) {
      const { error, count } = await supabase.from('field_definitions').delete({ count: 'exact' }).eq('id', fieldId);
      if (error) throw fromPostgrest(error);
      if (count === 0) throw new AppError('You do not have permission to delete this field.', '42501');
    },

    async listFieldUsages(projectId) {
      const { data, error } = await supabase
        .from('activity_fields')
        .select(
          'field_id, direction, node_key, version_id, process_nodes(label, ref_code), process_versions(version_number, status, process_id, processes(ref_code, name))',
        )
        .eq('project_id', projectId);
      if (error) throw fromPostgrest(error);
      return (data ?? []).map((row): FieldUsage => {
        const node = one(row.process_nodes as unknown as { label: string; ref_code: string | null } | null);
        const version = one(
          row.process_versions as unknown as {
            version_number: number;
            status: FieldUsage['versionStatus'];
            process_id: string;
            processes: { ref_code: string; name: string } | null;
          } | null,
        );
        const process = one(version?.processes ?? null);
        return {
          fieldId: row.field_id as string,
          direction: row.direction as FieldUsage['direction'],
          processId: version?.process_id ?? '',
          processRef: process?.ref_code ?? '',
          processName: process?.name ?? '',
          versionId: row.version_id as string,
          versionNumber: version?.version_number ?? 0,
          versionStatus: version?.status ?? 'draft',
          nodeKey: row.node_key as string,
          nodeRef: node?.ref_code ?? null,
          nodeLabel: node?.label ?? '',
        };
      });
    },

    async listValidationRules(projectId) {
      const { data, error } = await supabase.from('validation_rules').select('*').eq('project_id', projectId).order('ref_code');
      if (error) throw fromPostgrest(error);
      return ((data ?? []) as ValidationRuleRow[]).map(ruleFromRow);
    },

    async createValidationRule(projectId, input) {
      const { data, error } = await supabase
        .from('validation_rules')
        .insert({
          project_id: projectId,
          field_id: input.fieldId,
          rule_type: input.ruleType,
          params: input.params,
          statement: input.statement,
          error_message: input.errorMessage,
          source_text: input.sourceText,
          origin: input.origin,
          status: input.status,
          business_rule_id: input.businessRuleId,
        })
        .select('*')
        .single();
      if (error) throw fromPostgrest(error);
      return ruleFromRow(data as ValidationRuleRow);
    },

    async updateValidationRule(rule) {
      const { data, error } = await supabase
        .from('validation_rules')
        .update({
          rule_type: rule.ruleType,
          params: rule.params,
          statement: rule.statement,
          error_message: rule.errorMessage,
          status: rule.status,
          business_rule_id: rule.businessRuleId,
        })
        .eq('id', rule.id)
        .select('*')
        .maybeSingle();
      if (error) throw fromPostgrest(error);
      if (!data) throw new AppError('You do not have permission to change this rule.', '42501');
      return ruleFromRow(data as ValidationRuleRow);
    },

    async deleteValidationRule(ruleId) {
      const { error } = await supabase.from('validation_rules').delete().eq('id', ruleId);
      if (error) throw fromPostgrest(error);
    },

    async listPhysicalColumns(projectId) {
      const { data, error } = await supabase
        .from('physical_columns')
        .select('*')
        .eq('project_id', projectId)
        .order('system_name')
        .order('table_name')
        .order('column_name');
      if (error) throw fromPostgrest(error);
      return ((data ?? []) as PhysicalColumnRow[]).map(columnFromRow);
    },

    async createPhysicalColumn(projectId, input) {
      const { data, error } = await supabase
        .from('physical_columns')
        .insert({
          project_id: projectId,
          system_name: input.systemName.trim(),
          table_name: input.tableName.trim(),
          column_name: input.columnName.trim(),
          data_type: input.dataType.trim(),
          notes: input.notes,
        })
        .select('*')
        .single();
      if (error) throw fromPostgrest(error);
      return columnFromRow(data as PhysicalColumnRow);
    },

    async deletePhysicalColumn(columnId) {
      const { error } = await supabase.from('physical_columns').delete().eq('id', columnId);
      if (error) throw fromPostgrest(error);
    },

    async listColumnMappings(projectId) {
      const { data, error } = await supabase.from('field_column_mappings').select('*').eq('project_id', projectId);
      if (error) throw fromPostgrest(error);
      return (data ?? []).map((r) => ({
        fieldId: r.field_id as string,
        columnId: r.column_id as string,
        transformation: r.transformation as string,
      }));
    },

    async addColumnMapping(projectId, mapping) {
      const { error } = await supabase.from('field_column_mappings').insert({
        project_id: projectId,
        field_id: mapping.fieldId,
        column_id: mapping.columnId,
        transformation: mapping.transformation,
      });
      if (error) throw fromPostgrest(error);
    },

    async removeColumnMapping(fieldId, columnId) {
      const { error } = await supabase.from('field_column_mappings').delete().eq('field_id', fieldId).eq('column_id', columnId);
      if (error) throw fromPostgrest(error);
    },

    async listBusinessRules(projectId) {
      const [rules, links] = await Promise.all([
        supabase.from('business_rules').select('*').eq('project_id', projectId).order('ref_code'),
        supabase.from('business_rule_activities').select('*').eq('project_id', projectId),
      ]);
      if (rules.error) throw fromPostgrest(rules.error);
      if (links.error) throw fromPostgrest(links.error);
      return ((rules.data ?? []) as BusinessRuleRow[]).map((r) =>
        businessRuleFromRow(r, (links.data ?? []) as BusinessRuleActivityRow[]),
      );
    },

    async createBusinessRule(projectId, input) {
      const { data, error } = await supabase
        .from('business_rules')
        .insert({
          project_id: projectId,
          title: input.title,
          statement: input.statement,
          category: input.category,
          origin: input.origin,
        })
        .select('*')
        .single();
      if (error) throw fromPostgrest(error);
      const row = data as BusinessRuleRow;
      await replaceRuleLinks(projectId, row.id, input.activities);
      return { ...businessRuleFromRow(row, []), activities: input.activities };
    },

    async updateBusinessRule(rule) {
      const { data, error } = await supabase
        .from('business_rules')
        .update({ title: rule.title, statement: rule.statement, category: rule.category, status: rule.status })
        .eq('id', rule.id)
        .eq('revision', rule.revision)
        .select('*')
        .maybeSingle();
      if (error) throw fromPostgrest(error);
      if (!data)
        throw new AppError(
          `${rule.refCode} was changed by someone else since you opened it. Reload to see their changes.`,
          'PF409',
        );
      const row = data as BusinessRuleRow;
      await replaceRuleLinks(row.project_id, row.id, rule.activities);
      return { ...businessRuleFromRow(row, []), activities: rule.activities };
    },

    async deleteBusinessRule(ruleId) {
      const { error } = await supabase.from('business_rules').delete().eq('id', ruleId);
      if (error) throw fromPostgrest(error);
    },

    async listPromotableFindings(projectId) {
      const [findings, rules] = await Promise.all([
        supabase
          .from('process_findings')
          .select(
            'element_key, statement, version_id, process_versions(version_number, status, process_id, processes(ref_code, name))',
          )
          .eq('project_id', projectId)
          .eq('kind', 'business_rule')
          .neq('status', 'dismissed'),
        supabase.from('business_rules').select('source_finding_key').eq('project_id', projectId),
      ]);
      if (findings.error) throw fromPostgrest(findings.error);
      if (rules.error) throw fromPostgrest(rules.error);
      const promoted = new Set((rules.data ?? []).map((r) => r.source_finding_key as string | null));
      const rows = (findings.data ?? []).map((row) => {
        const version = one(
          row.process_versions as unknown as {
            version_number: number;
            process_id: string;
            processes: { ref_code: string; name: string } | null;
          } | null,
        );
        const process = one(version?.processes ?? null);
        return {
          versionId: row.version_id as string,
          findingKey: row.element_key as string,
          statement: row.statement as string,
          processId: version?.process_id ?? '',
          processRef: process?.ref_code ?? '',
          processName: process?.name ?? '',
          versionNumber: version?.version_number ?? 0,
          promoted: promoted.has(row.element_key as string),
        };
      });
      return latestFindingPerKey(rows);
    },

    async promoteFinding(input) {
      const { data, error } = await supabase.rpc('promote_finding_to_business_rule', {
        p_version_id: input.versionId,
        p_finding_key: input.findingKey,
        p_title: input.title,
        p_category: input.category,
      });
      if (error) throw fromPostgrest(error);
      return data as string;
    },

    async getVersionData(versionId) {
      const [version, fields, outputs] = await Promise.all([
        supabase.from('process_versions').select('data_revision').eq('id', versionId).single(),
        supabase.from('activity_fields').select('*').eq('version_id', versionId),
        supabase.from('activity_outputs').select('*').eq('version_id', versionId),
      ]);
      for (const result of [version, fields, outputs]) {
        if (result.error) throw fromPostgrest(result.error);
      }
      return {
        dataRevision: (version.data as { data_revision: number }).data_revision,
        requirements: requirementsFromRows(
          (fields.data ?? []) as ActivityFieldRow[],
          (outputs.data ?? []) as ActivityOutputRow[],
        ),
      };
    },

    async saveVersionData(payload) {
      const { data, error } = await supabase.rpc('save_version_data', payload);
      if (error) throw fromPostgrest(error);
      return data as number;
    },

    suggestFields(args, signal) {
      return postJson<DataSuggestionResponse>('/api/field-suggestions', args, signal);
    },

    translateValidationRule(args, signal) {
      return postJson<RuleTranslationResponse>('/api/rule-translation', args, signal);
    },
  };
}

async function replaceRuleLinks(projectId: string, ruleId: string, activities: BusinessRule['activities']) {
  const { error } = await supabase.from('business_rule_activities').delete().eq('business_rule_id', ruleId);
  if (error) throw fromPostgrest(error);
  if (activities.length === 0) return;
  const { error: insertError } = await supabase
    .from('business_rule_activities')
    .insert(
      activities.map((a) => ({ business_rule_id: ruleId, project_id: projectId, process_id: a.processId, node_key: a.nodeKey })),
    );
  if (insertError) throw fromPostgrest(insertError);
}
