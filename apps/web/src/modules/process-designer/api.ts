import type { ActorKind } from '@productflow/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backend, type ProcessDetailsInput } from '../../lib/backend';
import { processKeys } from '../processes/api';

export type { AnalysisResponse, ProcessDetail, VersionContent } from '../../lib/backend';

export const designerKeys = {
  process: (processId: string) => ['process', processId] as const,
  version: (versionId: string) => ['process-version', versionId] as const,
  actors: (projectId: string) => ['actors', projectId] as const,
};

export function useProcessDetail(processId: string) {
  return useQuery({ queryKey: designerKeys.process(processId), queryFn: () => backend.getProcessDetail(processId) });
}

export function fetchVersionContent(versionId: string) {
  return backend.getVersionContent(versionId);
}

export function useVersionContent(versionId: string | null) {
  return useQuery({
    queryKey: designerKeys.version(versionId ?? 'none'),
    enabled: Boolean(versionId),
    queryFn: () => backend.getVersionContent(versionId!),
    // The editor owns the state once loaded; never overwrite it behind the user's back.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useActors(projectId: string) {
  return useQuery({ queryKey: designerKeys.actors(projectId), queryFn: () => backend.listActors(projectId) });
}

export function useCreateActor(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; kind: ActorKind }) => backend.createActor(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: designerKeys.actors(projectId) }),
  });
}

export const ensureActors = backend.ensureActors.bind(backend);
export const saveDraft = backend.saveDraft.bind(backend);
export const approveVersion = backend.approveVersion.bind(backend);
export const createDraftFromVersion = backend.createDraftFromVersion.bind(backend);
export const analyseProcess = backend.analyseProcess.bind(backend);

export function useUpdateProcessDetails(processId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProcessDetailsInput) => backend.updateProcessDetails(processId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: designerKeys.process(processId) });
      qc.invalidateQueries({ queryKey: processKeys.list(projectId) });
    },
  });
}
