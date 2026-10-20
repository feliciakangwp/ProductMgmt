import type { ProcessRow, ProcessType, ProcessVersionRow } from '@productflow/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromPostgrest } from '../../lib/errors';
import { supabase } from '../../lib/supabase';

export type VersionSummary = Pick<ProcessVersionRow, 'id' | 'version_number' | 'status' | 'updated_at' | 'approved_at'>;

export interface ProcessSummary extends ProcessRow {
  versions: VersionSummary[];
}

export const processKeys = {
  list: (projectId: string) => ['processes', projectId] as const,
  detail: (processId: string) => ['process', processId] as const,
};

export function useProcesses(projectId: string) {
  return useQuery({
    queryKey: processKeys.list(projectId),
    queryFn: async (): Promise<ProcessSummary[]> => {
      const { data, error } = await supabase
        .from('processes')
        .select('*, process_versions(id, version_number, status, updated_at, approved_at)')
        .eq('project_id', projectId)
        .order('ref_code');
      if (error) throw fromPostgrest(error);
      return (data ?? []).map(({ process_versions, ...row }) => ({
        ...(row as ProcessRow),
        versions: ((process_versions ?? []) as VersionSummary[]).sort((a, b) => b.version_number - a.version_number),
      }));
    },
  });
}

export interface CreateProcessInput {
  projectId: string;
  name: string;
  processType: ProcessType;
  owner: string;
  businessUnit: string;
  description: string;
}

export function useCreateProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProcessInput) => {
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
    onSuccess: (_data, input) => qc.invalidateQueries({ queryKey: processKeys.list(input.projectId) }),
  });
}

export const PROCESS_TYPE_LABELS: Record<ProcessType, string> = { as_is: 'As-Is', to_be: 'To-Be' };
