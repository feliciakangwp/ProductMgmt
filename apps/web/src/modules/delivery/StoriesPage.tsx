import {
  approvedVersion,
  canDeliver,
  STORY_STATUS_LABELS,
  STORY_STATUSES,
  STORY_TYPE_LABELS,
  type Story,
  type StoryProposal,
  type StoryStatus,
  type StoryType,
} from '@productflow/domain';
import { FileCode2, Flag, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { Alert, Badge, Button, Dialog, EmptyState, Field, Input, Select } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useDelivery, useDeliveryAi } from './api';
import { AiGeneratedBadge, DeliveryPage, Loading, StoryStatusBadge, WorkStatusBadge } from './shared';
import { StoryDialog } from './StoryDialog';
import { StoryProposalDialog } from './StoryProposalDialog';

/** Tech User Story: functional and technical stories, from AI generation through review into the backlog. */
export function StoriesPage() {
  const { projectId = '' } = useParams();
  const { role, snapshot, context, lookups, isPending, error } = useDelivery(projectId);
  const [type, setType] = useState<StoryType | 'all'>('all');
  const [status, setStatus] = useState<StoryStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Story | StoryType | null>(null);
  const [generating, setGenerating] = useState(false);
  const [proposal, setProposal] = useState<StoryProposal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const stories = (snapshot?.stories ?? [])
    .filter((s) => type === 'all' || s.storyType === type)
    .filter((s) => status === 'all' || s.status === status)
    .filter((s) => !search || `${s.refCode} ${s.title}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.refCode.localeCompare(b.refCode, undefined, { numeric: true }));

  return (
    <DeliveryPage
      projectId={projectId}
      module="Tech User Story"
      title="User stories"
      description="Functional stories from approved processes, and the technical stories that implement them. Only approved stories enter the backlog."
      actions={
        <div className="flex flex-wrap gap-2">
          {canDeliver(role, 'editFunctional') ? (
            <Button icon={<Sparkles className="size-4" />} onClick={() => setGenerating(true)}>
              Generate from process
            </Button>
          ) : null}
          {canDeliver(role, 'editFunctional') ? (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen('functional')}>
              New functional story
            </Button>
          ) : null}
          {canDeliver(role, 'editTechnical') ? (
            <Button icon={<Plus className="size-4" />} onClick={() => setOpen('technical')}>
              New technical story
            </Button>
          ) : null}
        </div>
      }
    >
      <Loading isPending={isPending} error={error} />
      {notice ? (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      {snapshot && lookups && context ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Input
              aria-label="Search stories"
              placeholder="Search…"
              className="w-56"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              aria-label="Story type"
              className="w-44"
              value={type}
              onChange={(e) => setType(e.target.value as StoryType | 'all')}
            >
              <option value="all">All types</option>
              <option value="functional">Functional</option>
              <option value="technical">Technical</option>
            </Select>
            <Select
              aria-label="Story status"
              className="w-48"
              value={status}
              onChange={(e) => setStatus(e.target.value as StoryStatus | 'all')}
            >
              <option value="all">All statuses</option>
              {STORY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STORY_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          {snapshot.stories.length === 0 ? (
            <EmptyState icon={<FileCode2 className="size-8" />} title="No stories yet">
              Generate functional stories from an approved process, or write one yourself.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Story</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Covers</th>
                    <th className="px-3 py-2">Links</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stories.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <button type="button" className="text-left" onClick={() => setOpen(s)}>
                          <span className="font-mono text-xs text-slate-500">{s.refCode}</span>{' '}
                          <span className="font-medium text-slate-900 hover:text-brand-700">{s.title}</span>
                        </button>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {s.origin !== 'manual' ? <AiGeneratedBadge /> : null}
                          {s.storyType === 'technical' && s.designStatus === 'proposed' ? (
                            <Badge tone="amber">Proposed design</Badge>
                          ) : null}
                          {s.reviewFlag ? (
                            <Badge tone="red" title={s.reviewFlag}>
                              <Flag className="size-3" /> Review needed
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">{STORY_TYPE_LABELS[s.storyType]}</td>
                      <td className="space-x-1 px-3 py-2">
                        <StoryStatusBadge status={s.status} />
                        {s.status === 'in_backlog' ? <WorkStatusBadge status={s.workStatus} /> : null}
                      </td>
                      <td className="max-w-xs px-3 py-2 text-xs text-slate-600">
                        {s.activities.map((a) => lookups.activityName(a)).join(', ') || '–'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {s.implementsIds.length
                          ? `Implements ${s.implementsIds.map((id) => snapshot.stories.find((x) => x.id === id)?.refCode).join(', ')}`
                          : ''}
                        {s.storyType === 'functional'
                          ? `${snapshot.stories.filter((x) => x.implementsIds.includes(s.id)).length} technical`
                          : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {open ? (
            <StoryDialog
              projectId={projectId}
              story={typeof open === 'string' ? null : open}
              newType={typeof open === 'string' ? open : undefined}
              role={role}
              snapshot={snapshot}
              context={context}
              lookups={lookups}
              onClose={() => setOpen(null)}
            />
          ) : null}
          {generating ? (
            <GenerateDialog
              projectId={projectId}
              processes={context.processes.filter((p) => approvedVersion(context, p.id))}
              onClose={() => setGenerating(false)}
              onProposal={(p) => {
                setGenerating(false);
                setProposal(p);
              }}
            />
          ) : null}
          {proposal ? (
            <StoryProposalDialog
              projectId={projectId}
              proposal={proposal}
              lookups={lookups}
              onClose={() => setProposal(null)}
              onCreated={(n) => {
                setProposal(null);
                setNotice(`${n} stor${n === 1 ? 'y' : 'ies'} added as drafts.`);
              }}
            />
          ) : null}
        </>
      ) : null}
    </DeliveryPage>
  );
}

function GenerateDialog({
  projectId,
  processes,
  onClose,
  onProposal,
}: {
  projectId: string;
  processes: { id: string; ref_code: string; name: string }[];
  onClose: () => void;
  onProposal: (p: StoryProposal) => void;
}) {
  const [processId, setProcessId] = useState(processes[0]?.id ?? '');
  const generate = useDeliveryAi('generateStories');
  const [controller] = useState(() => new AbortController());
  return (
    <Dialog
      open
      onClose={() => {
        controller.abort();
        onClose();
      }}
      title="Generate user stories"
      description="Claude writes functional stories from the approved version of a process, its data requirements and business rules. You review them before anything is saved."
      footer={
        <>
          <Button
            onClick={() => {
              controller.abort();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Sparkles className="size-4" />}
            loading={generate.isPending}
            disabled={!processId}
            onClick={() =>
              generate.mutate({ input: { projectId, processId }, signal: controller.signal }, { onSuccess: onProposal })
            }
          >
            Generate stories
          </Button>
        </>
      }
    >
      {processes.length === 0 ? (
        <Alert tone="info">No process has an approved version yet. Stories are written from approved processes only.</Alert>
      ) : (
        <Field label="Process">
          {(id) => (
            <Select id={id} value={processId} onChange={(e) => setProcessId(e.target.value)}>
              {processes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.ref_code} {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {generate.isPending ? (
        <p className="mt-3 text-sm text-slate-500">Claude is reading the process… this can take a minute.</p>
      ) : null}
      {generate.error ? (
        <Alert tone="error" className="mt-3">
          {errorMessage(generate.error)}
        </Alert>
      ) : null}
    </Dialog>
  );
}
