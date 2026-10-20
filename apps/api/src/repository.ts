import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ProjectRole, VersionStatus } from '@productflow/domain';
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

/** Data access on behalf of one signed-in user. Every query runs under that user's RLS policies. */
export interface UserRepository {
  readonly userId: string;
  getVersionContext(versionId: string): Promise<VersionContext | null>;
  recordAnalysisRun(run: AnalysisRunRecord): Promise<string>;
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

    const process = (Array.isArray(version.processes) ? version.processes[0] : version.processes) as
      | { name: string; process_type: string }
      | null;
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
