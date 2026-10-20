import {
  activityIndex,
  activityKey,
  type DeliveryOpInput,
  type DeliveryOpName,
  type DeliveryOpResult,
  type ProjectContext,
} from '@productflow/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { backend } from '../../lib/backend';
import { useProject } from '../projects/api';

export const deliveryKeys = {
  all: (projectId: string) => ['delivery', projectId] as const,
  snapshot: (projectId: string) => ['delivery', projectId, 'snapshot'] as const,
  context: (projectId: string) => ['delivery', projectId, 'context'] as const,
};

/** Everything the delivery modules show: the delivery records and the project context they link to. */
export function useDelivery(projectId: string) {
  const project = useProject(projectId);
  const snapshot = useQuery({
    queryKey: deliveryKeys.snapshot(projectId),
    queryFn: () => backend.delivery.snapshot({ projectId }),
  });
  const context = useQuery({
    queryKey: deliveryKeys.context(projectId),
    queryFn: () => backend.delivery.projectContext({ projectId }),
  });
  const lookups = useMemo(() => (context.data ? buildLookups(context.data) : null), [context.data]);
  return {
    project: project.data ?? null,
    role: project.data?.role ?? null,
    snapshot: snapshot.data ?? null,
    context: context.data ?? null,
    lookups,
    isPending: snapshot.isPending || context.isPending || project.isPending,
    error: snapshot.error ?? context.error ?? project.error ?? null,
  };
}

export type Lookups = ReturnType<typeof buildLookups>;

function buildLookups(ctx: ProjectContext) {
  const activities = activityIndex(ctx);
  const members = new Map(ctx.members.map((m) => [m.userId, m]));
  const fields = new Map(ctx.fields.map((f) => [f.id, f]));
  return {
    activities,
    activity: (ref: { processId: string; nodeKey: string }) => activities.get(activityKey(ref)) ?? null,
    activityName: (ref: { processId: string; nodeKey: string }) => {
      const a = activities.get(activityKey(ref));
      return a ? `${a.refCode ? `${a.refCode} ` : ''}${a.label}` : 'Removed activity';
    },
    memberName: (id: string | null | undefined) => (id ? (members.get(id)?.displayName ?? 'Former member') : 'Unassigned'),
    members: ctx.members,
    developers: ctx.members.filter((m) => m.role === 'developer' || m.role === 'admin' || m.role === 'product_owner'),
    field: (id: string) => fields.get(id) ?? null,
    processName: (id: string | null) => {
      const p = ctx.processes.find((x) => x.id === id);
      return p ? `${p.ref_code} ${p.name}` : '';
    },
  };
}

/** Runs one delivery operation and refreshes the delivery data afterwards. */
export function useDeliveryOp<K extends DeliveryOpName>(projectId: string, op: K) {
  const qc = useQueryClient();
  return useMutation<DeliveryOpResult<K>, Error, DeliveryOpInput<K>>({
    mutationFn: (input) => (backend.delivery[op] as (i: DeliveryOpInput<K>) => Promise<DeliveryOpResult<K>>)(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: deliveryKeys.all(projectId) }),
  });
}

/** For AI operations, which can be cancelled and do not change data by themselves. */
export function useDeliveryAi<K extends DeliveryOpName>(op: K) {
  return useMutation<DeliveryOpResult<K>, Error, { input: DeliveryOpInput<K>; signal?: AbortSignal }>({
    mutationFn: ({ input, signal }) =>
      (backend.delivery[op] as (i: DeliveryOpInput<K>, s?: AbortSignal) => Promise<DeliveryOpResult<K>>)(input, signal),
  });
}
