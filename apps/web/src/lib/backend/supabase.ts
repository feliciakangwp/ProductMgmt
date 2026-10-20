import {
  findingFromRow,
  graphFromRows,
  type ActorRow,
  type ProcessEdgeRow,
  type ProcessFindingRow,
  type ProcessNodeRow,
  type ProcessRow,
  type ProcessVersionRow,
  type ProjectRole,
  type ProjectRow,
} from '@productflow/domain';
import type { Session } from '@supabase/supabase-js';
import { env } from '../env';
import { AppError, fromPostgrest } from '../errors';
import { supabase } from '../supabase';
import type { AnalysisResponse, Backend, Member, ProcessSummary, ProjectWithRole, SessionInfo, VersionSummary } from './types';

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
  return {
    mode: 'live',

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
          options: { data: { display_name: displayName } },
        });
        if (error) throw new AppError(error.message, error.code ?? null);
        return { needsConfirmation: !data.session };
      },
      async signOut() {
        await supabase.auth.signOut();
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
  };
}
