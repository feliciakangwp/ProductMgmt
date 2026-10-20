import {
  allowedDefectTransitions,
  checkDefectStatusChange,
  DEFECT_SEVERITIES,
  DEFECT_SEVERITY_LABELS,
  DEFECT_STATUS_LABELS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  PRIORITIES,
  PRIORITY_LABELS,
  type Attachment,
  type Defect,
  type DefectSeverity,
  type DeliverySnapshot,
  type Priority,
  type ProjectRole,
} from '@productflow/domain';
import { ImagePlus, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Dialog, Field, IconButton, Input, Select, Textarea } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useDeliveryOp, type Lookups } from './api';
import { DefectStatusBadge, History, LinkPicker } from './shared';

export interface DefectSource {
  executionId: string;
  stepId: string;
  stepNumber: number;
  scenarioRef: string;
  storyIds: string[];
  expectedResult: string;
  actualResult: string;
  remarks: string;
}

function readImage(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return reject(new Error('Attach a PNG, JPEG, GIF or WebP screenshot.'));
    if (file.size > MAX_ATTACHMENT_BYTES)
      return reject(new Error(`Screenshots must be ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB or smaller.`));
    const reader = new FileReader();
    reader.onload = () => resolve({ id: globalThis.crypto.randomUUID(), name: file.name, dataUrl: String(reader.result) });
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

/** Raise a defect (from a failed test step or by hand) or work an existing one through its lifecycle. */
export function DefectDialog({
  projectId,
  defect,
  source,
  role,
  snapshot,
  lookups,
  onClose,
}: {
  projectId: string;
  defect: Defect | null;
  source?: DefectSource;
  role: ProjectRole | null;
  snapshot: DeliverySnapshot;
  lookups: Lookups;
  onClose: () => void;
}) {
  const [value, setValue] = useState({
    title: defect?.title ?? (source ? `${source.scenarioRef} step ${source.stepNumber} failed` : ''),
    description: defect?.description ?? '',
    severity: defect?.severity ?? ('major' as DefectSeverity),
    priority: defect?.priority ?? ('high' as Priority),
    assigneeId: defect?.assigneeId ?? null,
    sprintId: defect?.sprintId ?? snapshot.sprints.find((s) => s.status === 'active')?.id ?? null,
    storyIds: defect?.storyIds ?? source?.storyIds ?? [],
    attachments: defect?.attachments ?? [],
    expectedResult: defect?.expectedResult ?? source?.expectedResult ?? '',
    actualResult: defect?.actualResult ?? source?.actualResult ?? '',
    remarks: defect?.remarks ?? source?.remarks ?? '',
  });
  const [fileError, setFileError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const create = useDeliveryOp(projectId, 'createDefect');
  const update = useDeliveryOp(projectId, 'updateDefect');
  const status = useDeliveryOp(projectId, 'setDefectStatus');
  const failed = create.error ?? update.error ?? status.error;
  const closed = defect?.status === 'closed';
  const set = <K extends keyof typeof value>(k: K, v: (typeof value)[K]) => setValue((x) => ({ ...x, [k]: v }));
  const scenario = defect?.scenarioId ? snapshot.scenarios.find((s) => s.id === defect.scenarioId) : null;
  const execution = defect?.executionId ? snapshot.executions.find((e) => e.id === defect.executionId) : null;

  const save = () => {
    if (!defect) {
      create.mutate(
        { projectId, ...value, ...(source ? { executionId: source.executionId, stepId: source.stepId } : {}) },
        { onSuccess: onClose },
      );
    } else {
      update.mutate({ defectId: defect.id, revision: defect.revision, patch: value });
    }
  };

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={defect ? `${defect.refCode} ${defect.title}` : 'Raise a defect'}
      description={
        defect ? (
          <span className="flex flex-wrap items-center gap-2">
            <DefectStatusBadge status={defect.status} />
            Raised by {lookups.memberName(defect.createdBy)} on {new Date(defect.createdAt).toLocaleDateString()}
            {defect.resolvedAt ? ` · Resolved ${new Date(defect.resolvedAt).toLocaleDateString()}` : ''}
          </span>
        ) : source ? (
          `From ${source.scenarioRef}, step ${source.stepNumber}. The scenario, step, stories and results are recorded with the defect.`
        ) : undefined
      }
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {!closed ? (
            <Button
              variant="primary"
              onClick={save}
              loading={create.isPending || update.isPending}
              disabled={!value.title.trim()}
            >
              {defect ? 'Save changes' : 'Raise defect'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {failed ? <Alert tone="error">{errorMessage(failed)}</Alert> : null}
        {defect ? (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <p className="text-xs font-semibold text-slate-700">Status</p>
            <Input
              aria-label="Status comment"
              placeholder="Comment (optional)"
              className="h-8 text-xs"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {allowedDefectTransitions(defect.status).map((to) => {
                const problem = checkDefectStatusChange({ ...defect, assigneeId: defect.assigneeId }, to, role);
                return (
                  <Button
                    key={to}
                    size="sm"
                    disabled={Boolean(problem)}
                    title={problem ?? undefined}
                    loading={status.isPending && status.variables?.status === to}
                    onClick={() =>
                      status.mutate(
                        { defectId: defect.id, revision: defect.revision, status: to, comment },
                        { onSuccess: () => setComment('') },
                      )
                    }
                  >
                    {to === 'closed' && defect.status !== 'ready_for_retest' ? 'Close without fix' : DEFECT_STATUS_LABELS[to]}
                  </Button>
                );
              })}
            </div>
            {scenario ? (
              <p className="text-xs text-slate-500">
                Found in {scenario.refCode} {scenario.title}
                {execution ? (
                  <>
                    {' '}
                    during{' '}
                    <Link className="text-brand-700 hover:underline" to={`/projects/${projectId}/testing/${execution.id}`}>
                      {execution.refCode}
                    </Link>
                  </>
                ) : null}
                . The scenario stays failed until it is retested.
              </p>
            ) : null}
          </div>
        ) : null}
        <Field label="Title">
          {(id) => <Input id={id} value={value.title} disabled={closed} onChange={(e) => set('title', e.target.value)} />}
        </Field>
        <Field label="Description">
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={value.description}
              disabled={closed}
              onChange={(e) => set('description', e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Severity">
            {(id) => (
              <Select
                id={id}
                value={value.severity}
                disabled={closed}
                onChange={(e) => set('severity', e.target.value as DefectSeverity)}
              >
                {DEFECT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {DEFECT_SEVERITY_LABELS[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Priority">
            {(id) => (
              <Select
                id={id}
                value={value.priority}
                disabled={closed}
                onChange={(e) => set('priority', e.target.value as Priority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Assigned developer">
            {(id) => (
              <Select
                id={id}
                value={value.assigneeId ?? ''}
                disabled={closed}
                onChange={(e) => set('assigneeId', e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {lookups.developers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Sprint">
            {(id) => (
              <Select
                id={id}
                value={value.sprintId ?? ''}
                disabled={closed}
                onChange={(e) => set('sprintId', e.target.value || null)}
              >
                <option value="">None</option>
                {snapshot.sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Expected result">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={value.expectedResult}
                disabled={closed}
                onChange={(e) => set('expectedResult', e.target.value)}
              />
            )}
          </Field>
          <Field label="Actual result">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={value.actualResult}
                disabled={closed}
                onChange={(e) => set('actualResult', e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Remarks">
          {(id) => (
            <Textarea id={id} rows={2} value={value.remarks} disabled={closed} onChange={(e) => set('remarks', e.target.value)} />
          )}
        </Field>
        <LinkPicker
          label="Technical stories"
          options={snapshot.stories.filter((s) => s.storyType === 'technical')}
          selected={value.storyIds}
          disabled={closed}
          onChange={(v) => set('storyIds', v)}
          render={(s) => `${s.refCode} ${s.title}`}
        />
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">
            Screenshots ({value.attachments.length}/{MAX_ATTACHMENTS})
          </p>
          <div className="flex flex-wrap gap-2">
            {value.attachments.map((a) => (
              <figure key={a.id} className="relative">
                <a href={a.dataUrl} target="_blank" rel="noreferrer">
                  <img src={a.dataUrl} alt={a.name} className="h-20 w-28 rounded border border-slate-200 object-cover" />
                </a>
                {!closed ? (
                  <IconButton
                    label={`Remove ${a.name}`}
                    icon={<X className="size-3" />}
                    className="absolute top-0.5 right-0.5 h-6 bg-white/80"
                    onClick={() =>
                      set(
                        'attachments',
                        value.attachments.filter((x) => x.id !== a.id),
                      )
                    }
                  />
                ) : null}
              </figure>
            ))}
            {!closed && value.attachments.length < MAX_ATTACHMENTS ? (
              <label className="flex h-20 w-28 cursor-pointer flex-col items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500">
                <ImagePlus className="size-4" />
                Add screenshot
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="sr-only"
                  aria-label="Add screenshot"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setFileError(null);
                    readImage(file).then(
                      (att) => set('attachments', [...value.attachments, att]),
                      (err: Error) => setFileError(err.message),
                    );
                  }}
                />
              </label>
            ) : null}
          </div>
          {fileError ? <p className="mt-1 text-xs text-red-600">{fileError}</p> : null}
        </div>
        {defect ? (
          <History projectId={projectId} entityType="defect" entityId={defect.id} events={snapshot.events} lookups={lookups} />
        ) : null}
      </div>
    </Dialog>
  );
}
