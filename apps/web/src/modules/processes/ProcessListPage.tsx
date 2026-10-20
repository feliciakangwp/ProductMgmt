import { can } from '@productflow/domain';
import { GitBranch, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert, Badge, Button, Dialog, EmptyState, Field, Spinner, Textarea } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useProject } from '../projects/api';
import { PROCESS_TYPE_LABELS, useCreateProcess, useProcesses, type ProcessSummary } from './api';
import { ProcessDetailsFields, type ProcessDetails } from './ProcessDetailsForm';
import { VersionStatusBadge } from './VersionStatusBadge';

export function ProcessListPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const processes = useProcesses(projectId);
  const [creating, setCreating] = useState(false);
  const canEdit = can(project.data?.role, 'editProcess');

  if (project.isPending) return <Spinner />;
  if (!project.data) {
    return (
      <div className="p-8">
        <EmptyState title="Project not found">You may not be a member of this project.</EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-brand-700">{project.data.key} · Process Designer</p>
          <h1 className="text-xl font-semibold text-slate-900">Business processes</h1>
          <p className="text-sm text-slate-500">
            Describe a process in plain language and let AI draft the process map for you to review.
          </p>
        </div>
        {canEdit ? (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New process
          </Button>
        ) : null}
      </div>

      {processes.isPending ? <Spinner /> : null}
      {processes.error ? (
        <Alert tone="error" title="Could not load processes">
          {errorMessage(processes.error)}
        </Alert>
      ) : null}
      {processes.data && processes.data.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="size-8" />}
          title="No processes yet"
          action={
            canEdit ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                Create a process
              </Button>
            ) : undefined
          }
        >
          {canEdit
            ? 'Start by describing how a business process works today, or how it should work.'
            : 'Business Analysts in this project have not created any processes yet.'}
        </EmptyState>
      ) : null}
      {processes.data && processes.data.length > 0 ? <ProcessTable projectId={projectId} processes={processes.data} /> : null}

      {canEdit ? <CreateProcessDialog projectId={projectId} open={creating} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function ProcessTable({ projectId, processes }: { projectId: string; processes: ProcessSummary[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
          <tr>
            <th className="px-4 py-2.5">ID</th>
            <th className="px-4 py-2.5">Process</th>
            <th className="px-4 py-2.5">State</th>
            <th className="px-4 py-2.5">Owner / Unit</th>
            <th className="px-4 py-2.5">Latest version</th>
            <th className="px-4 py-2.5">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {processes.map((p) => {
            const latest = p.versions[0];
            const approved = p.versions.find((v) => v.status === 'approved');
            return (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.ref_code}</td>
                <td className="px-4 py-3">
                  <Link to={`/projects/${projectId}/processes/${p.id}`} className="font-medium text-brand-700 hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={p.process_type === 'to_be' ? 'violet' : 'slate'}>{PROCESS_TYPE_LABELS[p.process_type]}</Badge>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {p.owner || '—'}
                  {p.business_unit ? <span className="block text-xs text-slate-400">{p.business_unit}</span> : null}
                </td>
                <td className="px-4 py-3">
                  {latest ? (
                    <span className="inline-flex items-center gap-2">
                      v{latest.version_number} <VersionStatusBadge status={latest.status} />
                    </span>
                  ) : (
                    '—'
                  )}
                  {approved && approved !== latest ? (
                    <span className="block text-xs text-slate-400">v{approved.version_number} approved</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-500">{latest ? new Date(latest.updated_at).toLocaleString() : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreateProcessDialog({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateProcess();
  const empty: ProcessDetails = { name: '', processType: 'as_is', owner: '', businessUnit: '' };
  const [details, setDetails] = useState<ProcessDetails>(empty);
  const [description, setDescription] = useState('');

  function close() {
    setDetails(empty);
    setDescription('');
    create.reset();
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = await create.mutateAsync({ projectId, ...details, name: details.name.trim(), description }).catch(() => null);
    if (result) {
      close();
      navigate(`/projects/${projectId}/processes/${result.process_id}`);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title="New process"
      description="You can refine the description and generate the process map in the designer."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            type="submit"
            form="create-process"
            variant="primary"
            loading={create.isPending}
            disabled={!details.name.trim()}
          >
            Create and open designer
          </Button>
        </>
      }
    >
      <form id="create-process" onSubmit={submit} className="space-y-4">
        {create.error ? <Alert tone="error">{errorMessage(create.error)}</Alert> : null}
        <ProcessDetailsFields value={details} onChange={setDetails} />
        <Field label="Process description (optional)" hint="Describe who does what, in what order, and what decisions are made.">
          {(id) => (
            <Textarea id={id} rows={6} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={20000} />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
