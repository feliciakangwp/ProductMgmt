import type { ProjectRole, ProjectRow } from '@productflow/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { fromPostgrest } from '../../lib/errors';
import { supabase } from '../../lib/supabase';

export interface ProjectWithRole extends ProjectRow {
  role: ProjectRole;
}

export interface Member {
  userId: string;
  role: ProjectRole;
  displayName: string;
  email: string;
  createdAt: string;
}

export const projectKeys = {
  all: ['projects'] as const,
  members: (projectId: string) => ['projects', projectId, 'members'] as const,
};

export function useProjects() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: [...projectKeys.all, userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<ProjectWithRole[]> => {
      const { data, error } = await supabase.from('project_members').select('role, projects(*)').eq('user_id', userId!);
      if (error) throw fromPostgrest(error);
      return (data ?? [])
        .map((row) => {
          const project = (Array.isArray(row.projects) ? row.projects[0] : row.projects) as ProjectRow | null;
          return project ? { ...project, role: row.role as ProjectRole } : null;
        })
        .filter((p): p is ProjectWithRole => p !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

export function useProject(projectId: string | undefined) {
  const query = useProjects();
  return { ...query, data: query.data?.find((p) => p.id === projectId) };
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; name: string; description: string }) => {
      const { data, error } = await supabase.rpc('create_project', {
        p_key: input.key,
        p_name: input.name,
        p_description: input.description,
      });
      if (error) throw fromPostgrest(error);
      return data as ProjectRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name: string; description: string }) => {
      const { error, count } = await supabase
        .from('projects')
        .update({ name: input.name, description: input.description }, { count: 'exact' })
        .eq('id', input.id);
      if (error) throw fromPostgrest(error);
      if (count === 0) throw new Error('Only project administrators can change project details.');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useMembers(projectId: string) {
  return useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await supabase
        .from('project_members')
        .select('user_id, role, created_at, profiles!project_members_user_id_fkey(display_name, email)')
        .eq('project_id', projectId)
        .order('created_at');
      if (error) throw fromPostgrest(error);
      return (data ?? []).map((row) => {
        const profile = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as {
          display_name: string;
          email: string;
        } | null;
        return {
          userId: row.user_id as string,
          role: row.role as ProjectRole,
          createdAt: row.created_at as string,
          displayName: profile?.display_name ?? 'Unknown user',
          email: profile?.email ?? '',
        };
      });
    },
  });
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
  return useMemberMutation(projectId, async (input: { email: string; role: ProjectRole }) => {
    const { error } = await supabase.rpc('add_project_member', {
      p_project_id: projectId,
      p_email: input.email,
      p_role: input.role,
    });
    if (error) throw fromPostgrest(error);
  });
}

export function useUpdateMemberRole(projectId: string) {
  return useMemberMutation(projectId, async (input: { userId: string; role: ProjectRole }) => {
    const { error } = await supabase.rpc('update_member_role', {
      p_project_id: projectId,
      p_user_id: input.userId,
      p_role: input.role,
    });
    if (error) throw fromPostgrest(error);
  });
}

export function useRemoveMember(projectId: string) {
  return useMemberMutation(projectId, async (input: { userId: string }) => {
    const { error } = await supabase.rpc('remove_project_member', { p_project_id: projectId, p_user_id: input.userId });
    if (error) throw fromPostgrest(error);
  });
}
