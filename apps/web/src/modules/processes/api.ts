import type { ProcessType } from '@productflow/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backend, type CreateProcessInput } from '../../lib/backend';

export type { CreateProcessInput, ProcessSummary, VersionSummary } from '../../lib/backend';

export const processKeys = {
  list: (projectId: string) => ['processes', projectId] as const,
  detail: (processId: string) => ['process', processId] as const,
};

export function useProcesses(projectId: string) {
  return useQuery({ queryKey: processKeys.list(projectId), queryFn: () => backend.listProcesses(projectId) });
}

export function useCreateProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProcessInput) => backend.createProcess(input),
    onSuccess: (_data, input) => qc.invalidateQueries({ queryKey: processKeys.list(input.projectId) }),
  });
}

export const PROCESS_TYPE_LABELS: Record<ProcessType, string> = { as_is: 'As-Is', to_be: 'To-Be' };
