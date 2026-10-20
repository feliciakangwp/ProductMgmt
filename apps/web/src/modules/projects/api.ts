import type { ProjectRole } from '@productflow/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { backend } from '../../lib/backend';

export type { Member, ProjectWithRole } from '../../lib/backend';

export const projectKeys = {
  all: ['projects'] as const,
  members: (projectId: string) => ['projects', projectId, 'members'] as const,
};

export function useProjects() {
  const { session } = useAuth();
  const userId = session?.userId;
  return useQuery({
    queryKey: [...projectKeys.all, userId],
    enabled: Boolean(userId),
    queryFn: () => backend.listMyProjects(userId!),
  });
}

export function useProject(projectId: string | undefined) {
  const query = useProjects();
  return { ...query, data: query.data?.find((p) => p.id === projectId) };
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { key: string; name: string; description: string }) => backend.createProject(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name: string; description: string }) => backend.updateProject(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useMembers(projectId: string) {
  return useQuery({ queryKey: projectKeys.members(projectId), queryFn: () => backend.listMembers(projectId) });
}

function useMemberMutation<T>(projectId: string, fn: (input: T) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.members(projectId) });
      qc.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

export function useAddMember(projectId: string) {
  return useMemberMutation(projectId, (input: { email: string; role: ProjectRole }) =>
    backend.addMember(projectId, input.email, input.role),
  );
}

export function useUpdateMemberRole(projectId: string) {
  return useMemberMutation(projectId, (input: { userId: string; role: ProjectRole }) =>
    backend.updateMemberRole(projectId, input.userId, input.role),
  );
}

export function useRemoveMember(projectId: string) {
  return useMemberMutation(projectId, (input: { userId: string }) => backend.removeMember(projectId, input.userId));
}
