import {
  findingFromRow,
  graphFromRows,
  type Actor,
  type ActorKind,
  type ActorRow,
  type ProcessFinding,
  type ProcessFindingRow,
  type ProcessGraph,
  type ProcessEdgeRow,
  type ProcessNodeRow,
  type ProcessRow,
  type ProcessType,
  type ProcessVersionRow,
  type ProposedActor,
  type SaveDraftPayload,
} from '@productflow/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromPostgrest } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { processKeys } from '../processes/api';

export const designerKeys = {
  process: (processId: string) => ['process', processId] as const,
  version: (versionId: string) => ['process-version', versionId] as const,
  actors: (projectId: string) => ['actors', projectId] as const,
};

export interface ProcessDetail {
  process: ProcessRow;
  versions: ProcessVersionRow[];
}

export function useProcessDetail(processId: string) {
  return useQuery({
    queryKey: designerKeys.process(processId),
    queryFn: async (): Promise<ProcessDetail | null> => {
      const [process, versions] = await Promise.all([
        supabase.from('processes').select('*').eq('id', processId).maybeSingle(),
        supabase.from('process_versions').select('*').eq('process_id', processId).order('version_number', { ascending: false }),
      ]);
      if (process.error) throw fromPostgrest(process.error);
      if (versions.error) throw fromPostgrest(versions.error);
      if (!process.data) return null;
      return { process: process.data as ProcessRow, versions: (versions.data ?? []) as ProcessVersionRow[] };
    },
  });
}

export interface VersionContent {
  version: ProcessVersionRow;
  graph: ProcessGraph;
  findings: ProcessFinding[];
}

export async function fetchVersionContent(versionId: string): Promise<VersionContent> {
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
}

export function useVersionContent(versionId: string | null) {
  return useQuery({
    queryKey: designerKeys.version(versionId ?? 'none'),
    enabled: Boolean(versionId),
    queryFn: () => fetchVersionContent(versionId!),
    // The editor owns the state once loaded; never overwrite it behind the user's back.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useActors(projectId: string) {
  return useQuery({
    queryKey: designerKeys.actors(projectId),
    queryFn: async (): Promise<Actor[]> => {
      const { data, error } = await supabase.from('actors').select('*').eq('project_id', projectId).order('name');
      if (error) throw fromPostgrest(error);
      return ((data ?? []) as ActorRow[]).map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
    },
  });
}

export function useCreateActor(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; kind: ActorKind }): Promise<Actor> => {
      const { data, error } = await supabase
        .from('actors')
        .insert({ project_id: projectId, name: input.name.trim(), kind: input.kind })
        .select('*')
        .single();
      if (error) throw fromPostgrest(error);
      const row = data as ActorRow;
      return { id: row.id, name: row.name, kind: row.kind };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: designerKeys.actors(projectId) }),
  });
}

/** Creates any proposed actors that do not exist yet and returns the project's matching actors. */
export async function ensureActors(projectId: string, actors: ProposedActor[]): Promise<Actor[]> {
  if (actors.length === 0) return [];
  const { data, error } = await supabase.rpc('ensure_actors', { p_project_id: projectId, p_actors: actors });
  if (error) throw fromPostgrest(error);
  return ((data ?? []) as ActorRow[]).map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
}

export async function saveDraft(payload: SaveDraftPayload): Promise<number> {
  const { data, error } = await supabase.rpc('save_process_draft', payload);
  if (error) throw fromPostgrest(error);
  return data as number;
}

export async function approveVersion(versionId: string, revision: number): Promise<void> {
  const { error } = await supabase.rpc('approve_process_version', { p_version_id: versionId, p_expected_revision: revision });
  if (error) throw fromPostgrest(error);
}

export async function createDraftFromVersion(versionId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_draft_from_version', { p_version_id: versionId });
  if (error) throw fromPostgrest(error);
  return data as string;
}

export function useUpdateProcessDetails(processId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; processType: ProcessType; owner: string; businessUnit: string }) => {
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
      if (count === 0) throw new Error('You do not have permission to edit this process.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: designerKeys.process(processId) });
      qc.invalidateQueries({ queryKey: processKeys.list(projectId) });
    },
  });
}
