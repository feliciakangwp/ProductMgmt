import {
  DEFECT_SEVERITY_LABELS,
  DEFECT_STATUS_LABELS,
  DEFECT_STATUSES,
  type Defect,
  type DefectStatus,
} from '@productflow/domain';
import { Bug, Plus } from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { Button, EmptyState, Input, Select } from '../../components/ui';
import { useDelivery } from './api';
import { DefectDialog } from './DefectDialog';
import { DefectStatusBadge, DeliveryPage, formatDate, Loading, PriorityBadge } from './shared';

/** Defect Tracking: the defect register, from open to closed. */
export function DefectsPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { role, snapshot, lookups, isPending, error } = useDelivery(projectId);
  const [status, setStatus] = useState<DefectStatus | 'open_all' | 'all'>('open_all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const openId = params.get('open');
  const opened: Defect | null = (openId && snapshot?.defects.find((d) => d.id === openId)) || null;
  const setOpened = (d: Defect | null) => setParams(d ? { open: d.id } : {}, { replace: true });

  const defects = (snapshot?.defects ?? [])
    .filter((d) => (status === 'all' ? true : status === 'open_all' ? d.status !== 'closed' : d.status === status))
    .filter((d) => !search || `${d.refCode} ${d.title}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <DeliveryPage
      projectId={projectId}
      module="Defect Tracking"
      title="Defects"
      description="Defects raised from testing, assigned to developers and verified by retesting."
      actions={
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Raise defect
        </Button>
      }
    >
      <Loading isPending={isPending} error={error} />
      {snapshot && lookups ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Input
              aria-label="Search defects"
              placeholder="Search…"
              className="w-56"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              aria-label="Defect status"
              className="w-48"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="open_all">All not closed</option>
              <option value="all">All</option>
              {DEFECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {DEFECT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          {snapshot.defects.length === 0 ? (
            <EmptyState icon={<Bug className="size-8" />} title="No defects">
              Defects raised from failed test steps appear here.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Defect</th>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2">Priority</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Scenario</th>
                    <th className="px-3 py-2">Stories</th>
                    <th className="px-3 py-2">Developer</th>
                    <th className="px-3 py-2">Raised</th>
                    <th className="px-3 py-2">Resolved</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {defects.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <button type="button" className="text-left" onClick={() => setOpened(d)}>
                          <span className="font-mono text-xs text-slate-500">{d.refCode}</span>{' '}
                          <span className="font-medium hover:text-brand-700">{d.title}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2">{DEFECT_SEVERITY_LABELS[d.severity]}</td>
                      <td className="px-3 py-2">
                        <PriorityBadge priority={d.priority} />
                      </td>
                      <td className="px-3 py-2">
                        <DefectStatusBadge status={d.status} />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {snapshot.scenarios.find((s) => s.id === d.scenarioId)?.refCode ?? '–'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {d.storyIds.map((id) => snapshot.stories.find((s) => s.id === id)?.refCode).join(', ') || '–'}
                      </td>
                      <td className="px-3 py-2 text-xs">{lookups.memberName(d.assigneeId)}</td>
                      <td className="px-3 py-2 text-xs">{formatDate(d.createdAt)}</td>
                      <td className="px-3 py-2 text-xs">{formatDate(d.resolvedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {opened || creating ? (
            <DefectDialog
              projectId={projectId}
              defect={opened}
              role={role}
              snapshot={snapshot}
              lookups={lookups}
              onClose={() => {
                setCreating(false);
                setOpened(null);
              }}
            />
          ) : null}
        </>
      ) : null}
    </DeliveryPage>
  );
}
