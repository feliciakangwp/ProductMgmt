import {
  can,
  PROJECT_ROLE_LABELS,
  resolveProposalActors,
  toSavePayload,
  validateProcess,
  type ProcessVersionRow,
} from '@productflow/domain';
import { useQueryClient } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { clsx } from 'clsx';
import { ArrowLeft, CheckCircle2, CopyPlus, Pencil, Redo2, Save, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import { Alert, Badge, Button, Dialog, IconButton, Select, Spinner } from '../../components/ui';

import { errorMessage, isConflict } from '../../lib/errors';
import { PROCESS_TYPE_LABELS } from '../processes/api';
import { ProcessDetailsFields, type ProcessDetails } from '../processes/ProcessDetailsForm';
import { VersionStatusBadge } from '../processes/VersionStatusBadge';
import { useProject, type ProjectWithRole } from '../projects/api';
import {
  analyseProcess,
  approveVersion,
  createDraftFromVersion,
  designerKeys,
  ensureActors,
  fetchVersionContent,
  saveDraft,
  useActors,
  useProcessDetail,
  useUpdateProcessDetails,
  useVersionContent,
  type AnalysisResponse,
  type ProcessDetail,
  type VersionContent,
} from './api';
import { ApproveDialog } from './ApproveDialog';
import { DescriptionPanel } from './DescriptionPanel';
import { designerReducer, initialDesignerState, type DesignerState } from './designer-state';
import { clearDraftBackup, readDraftBackup, useDraftBackup, type DraftBackup } from './draft-backup';
import { FindingsPanel } from './FindingsPanel';
import { ProcessCanvas } from './ProcessCanvas';
import { PropertiesPanel } from './PropertiesPanel';
import { ProposalDialog } from './ProposalDialog';
import { ValidationPanel } from './ValidationPanel';

/** The open draft if there is one, otherwise the latest version. */
export function defaultVersionId(versions: ProcessVersionRow[]): string | null {
  return (versions.find((v) => v.status === 'draft') ?? versions[0])?.id ?? null;
}

export function DesignerPage() {
  const { projectId = '', processId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const project = useProject(projectId);
  const detail = useProcessDetail(processId);
  const versions = detail.data?.versions ?? [];
  const requested = searchParams.get('version');
  const versionId = requested && versions.some((v) => v.id === requested) ? requested : defaultVersionId(versions);
  const content = useVersionContent(versionId);
  const [reloadToken, setReloadToken] = useState(0);

  if (detail.isPending || project.isPending || (versionId && content.isPending))
    return <Spinner label="Loading process…" className="h-full" />;
  const error = detail.error ?? project.error ?? content.error;
  if (error)
    return (
      <div className="p-8">
        <Alert tone="error" title="Could not load the process">
          {errorMessage(error)}
        </Alert>
      </div>
    );
  if (!detail.data || !project.data || !content.data) {
    return (
      <div className="p-8">
        <Alert tone="warning" title="Process not found">
          It may have been removed, or you may not have access to it.
        </Alert>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <DesignerWorkspace
        key={`${content.data.version.id}:${reloadToken}`}
        project={project.data}
        detail={detail.data}
        content={content.data}
        onReload={async () => {
          await Promise.all([content.refetch(), detail.refetch()]);
          setReloadToken((t) => t + 1);
        }}
      />
    </ReactFlowProvider>
  );
}

type PanelTab = 'properties' | 'validation' | 'findings';

function DesignerWorkspace({
  project,
  detail,
  content,
  onReload,
}: {
  project: ProjectWithRole;
  detail: ProcessDetail;
  content: VersionContent;
  onReload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { process } = detail;
  const version = content.version;
  const actors = useActors(project.id);
  const canEdit = can(project.role, 'editProcess');
  const canApprove = can(project.role, 'approveProcess');
  const readOnly = version.status !== 'draft' || !canEdit;
  const openDraft = detail.versions.find((v) => v.status === 'draft');

  const [state, dispatch] = useReducer(designerReducer, initialDesignerState, (s): DesignerState =>
    designerReducer(s, {
      type: 'load',
      versionId: version.id,
      revision: version.revision,
      description: version.description,
      graph: content.graph,
      findings: content.findings,
    }),
  );
  const [tab, setTab] = useState<PanelTab>('properties');
  const [fitSignal, setFitSignal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AnalysisResponse | null>(null);
  const [approving, setApproving] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [backup, setBackup] = useState<DraftBackup | null>(() => {
    if (readOnly) return null;
    const found = readDraftBackup(version.id);
    if (found && found.revision !== version.revision) {
      clearDraftBackup(version.id);
      return null;
    }
    return found;
  });

  const issues = useMemo(
    () => validateProcess({ ...state.graph, actors: actors.data, findings: state.findings }),
    [state.graph, state.findings, actors.data],
  );
  const errorCount = issues.filter((i) => i.severity === 'error').length;

  useDraftBackup({
    versionId: version.id,
    enabled: !readOnly,
    dirty: state.dirty,
    revision: state.revision,
    description: state.description,
    graph: state.graph,
    findings: state.findings,
  });

  // Select the properties tab when the user picks something on the map.
  useEffect(() => {
    if (state.selection) setTab('properties');
  }, [state.selection]);

  // Guard against losing unsaved work: in-app navigation and closing the tab.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      state.dirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (!state.dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state.dirty]);

  /** Saves the draft. Resolves to true when the editor's state is stored. */
  const save = useCallback(async (): Promise<boolean> => {
    if (readOnly || saving) return false;
    if (!state.dirty) return true;
    setSaving(true);
    setSaveError(null);
    const sent = {
      description: state.description,
      graph: state.graph,
      findings: state.findings,
      analysisRunId: state.analysisRunId,
    };
    try {
      const revision = await saveDraft(toSavePayload({ versionId: version.id, expectedRevision: state.revision, ...sent }));
      dispatch({ type: 'saved', revision, ...sent });
      clearDraftBackup(version.id);
      qc.invalidateQueries({ queryKey: designerKeys.process(process.id) });
      qc.invalidateQueries({ queryKey: ['processes', project.id] });
      // New nodes receive ref codes from the database; show them without disturbing the editor.
      const fresh = await qc.fetchQuery({
        queryKey: designerKeys.version(version.id),
        queryFn: () => fetchVersionContent(version.id),
        staleTime: 0,
      });
      dispatch({ type: 'applyRefCodes', refCodes: Object.fromEntries(fresh.graph.nodes.map((n) => [n.elementKey, n.refCode])) });
      return true;
    } catch (err) {
      setSaveError({ message: errorMessage(err), conflict: isConflict(err) });
      return false;
    } finally {
      setSaving(false);
    }
  }, [readOnly, saving, state, version.id, qc, process.id, project.id]);

  // Keyboard shortcuts: save, undo, redo. Text fields keep their native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        void save();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (readOnly) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'undo' });
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, readOnly]);

  async function runAnalysis() {
    setAnalysing(true);
    setAnalysisError(null);
    try {
      setProposal(await analyseProcess({ versionId: version.id, description: state.description }));
    } catch (err) {
      setAnalysisError(errorMessage(err));
    } finally {
      setAnalysing(false);
    }
  }

  async function acceptProposal(response: AnalysisResponse) {
    const stored = await ensureActors(project.id, response.proposal.actors);
    await qc.invalidateQueries({ queryKey: designerKeys.actors(project.id) });
    const known = new Map([...(actors.data ?? []), ...stored].map((a) => [a.id, a]));
    const graph = resolveProposalActors(response.proposal, [...known.values()]);
    dispatch({ type: 'acceptProposal', graph, findings: response.proposal.findings, analysisRunId: response.runId });
    setProposal(null);
    setFitSignal((n) => n + 1);
    setTab('validation');
  }

  async function approve() {
    await approveVersion(version.id, state.revision);
    setApproving(false);
    qc.removeQueries({ queryKey: designerKeys.version(version.id) });
    qc.invalidateQueries({ queryKey: ['processes', project.id] });
    await onReload();
  }

  async function newDraft() {
    setCreatingDraft(true);
    try {
      const id = await createDraftFromVersion(version.id);
      await qc.invalidateQueries({ queryKey: designerKeys.process(process.id) });
      qc.invalidateQueries({ queryKey: ['processes', project.id] });
      navigate(`?version=${id}`);
    } catch (err) {
      setSaveError({ message: errorMessage(err), conflict: false });
    } finally {
      setCreatingDraft(false);
    }
  }

  const readOnlyReason =
    version.status !== 'draft'
      ? `Version ${version.version_number} is ${version.status}. It cannot be changed.`
      : !canEdit
        ? `You have read-only access as ${PROJECT_ROLE_LABELS[project.role]}.`
        : null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <Link
          to={`/projects/${project.id}/processes`}
          className="text-slate-400 hover:text-slate-700"
          aria-label="Back to processes"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-slate-500">{process.ref_code}</span>
            <h1 className="truncate text-base font-semibold text-slate-900">{process.name}</h1>
            <Badge tone={process.process_type === 'to_be' ? 'violet' : 'slate'}>
              {PROCESS_TYPE_LABELS[process.process_type]}
            </Badge>
            <IconButton
              label="Edit process details"
              icon={<Pencil className="size-3.5" />}
              onClick={() => setEditingDetails(true)}
            />
          </div>
          <p className="truncate text-xs text-slate-500">
            {[process.owner && `Owner: ${process.owner}`, process.business_unit && `Unit: ${process.business_unit}`]
              .filter(Boolean)
              .join(' · ') || 'No owner or business unit set'}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            aria-label="Version"
            className="h-8 w-56 text-xs"
            value={version.id}
            onChange={(e) => navigate(`?version=${e.target.value}`)}
          >
            {detail.versions.map((v) => (
              <option key={v.id} value={v.id}>
                Version {v.version_number} ·{' '}
                {v.status === 'draft' ? 'Draft' : v.status === 'approved' ? 'Approved' : 'Superseded'} ·{' '}
                {new Date(v.updated_at).toLocaleDateString()}
              </option>
            ))}
          </Select>
          <VersionStatusBadge status={version.status} />
          {!readOnly ? (
            <>
              <span className={clsx('text-xs', state.dirty ? 'text-amber-700' : 'text-slate-400')} aria-live="polite">
                {saving ? 'Saving…' : state.dirty ? 'Unsaved changes' : 'All changes saved'}
              </span>
              <IconButton
                label="Undo (Ctrl+Z)"
                icon={<Undo2 className="size-4" />}
                disabled={state.past.length === 0}
                onClick={() => dispatch({ type: 'undo' })}
              />
              <IconButton
                label="Redo (Ctrl+Shift+Z)"
                icon={<Redo2 className="size-4" />}
                disabled={state.future.length === 0}
                onClick={() => dispatch({ type: 'redo' })}
              />
              <Button
                size="sm"
                variant="primary"
                icon={<Save className="size-3.5" />}
                loading={saving}
                disabled={!state.dirty}
                onClick={() => void save()}
              >
                Save
              </Button>
            </>
          ) : null}
          {version.status === 'draft' && canApprove ? (
            <Button
              size="sm"
              icon={<CheckCircle2 className="size-3.5 text-emerald-600" />}
              disabled={state.dirty}
              title={state.dirty ? 'Save your changes before approving' : undefined}
              onClick={() => setApproving(true)}
            >
              Approve
            </Button>
          ) : null}
          {version.status !== 'draft' && canEdit && !openDraft ? (
            <Button size="sm" icon={<CopyPlus className="size-3.5" />} loading={creatingDraft} onClick={() => void newDraft()}>
              Create new draft
            </Button>
          ) : null}
        </div>
      </div>

      {/* Notices */}
      <div className="space-y-2 empty:hidden [&>*]:mx-4 [&>*:first-child]:mt-2">
        {readOnlyReason ? (
          <Alert
            tone="info"
            action={
              openDraft && openDraft.id !== version.id ? (
                <Button size="sm" onClick={() => navigate(`?version=${openDraft.id}`)}>
                  Open draft v{openDraft.version_number}
                </Button>
              ) : undefined
            }
          >
            {readOnlyReason}
            {version.status !== 'draft' && canEdit && !openDraft ? ' Create a new draft to make changes.' : null}
          </Alert>
        ) : null}
        {backup ? (
          <Alert
            tone="warning"
            title="Unsaved changes were recovered"
            action={
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    clearDraftBackup(version.id);
                    setBackup(null);
                  }}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    dispatch({
                      type: 'restore',
                      description: backup.description,
                      graph: backup.graph,
                      findings: backup.findings,
                    });
                    setBackup(null);
                    setFitSignal((n) => n + 1);
                  }}
                >
                  Restore
                </Button>
              </div>
            }
          >
            Edits from {new Date(backup.savedAt).toLocaleString()} were not saved. Restore them into the editor?
          </Alert>
        ) : null}
        {saveError ? (
          <Alert
            tone="error"
            title={saveError.conflict ? 'Someone else saved this draft' : 'Save failed'}
            action={
              saveError.conflict ? (
                <Button
                  size="sm"
                  onClick={() => {
                    if (window.confirm('Reload the latest saved version? Your unsaved changes in this tab will be lost.')) {
                      clearDraftBackup(version.id);
                      void onReload();
                    }
                  }}
                >
                  Reload latest
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setSaveError(null)}>
                  Dismiss
                </Button>
              )
            }
          >
            {saveError.message}
          </Alert>
        ) : null}
      </div>

      {/* Workspace */}
      <div className="flex min-h-0 flex-1">
        <DescriptionPanel
          description={state.description}
          onChange={(description) => dispatch({ type: 'setDescription', description })}
          readOnly={readOnly}
          canAnalyse={can(project.role, 'runAnalysis') && version.status === 'draft'}
          analysing={analysing}
          error={analysisError}
          onAnalyse={() => void runAnalysis()}
        />
        <div className="min-w-0 flex-1 bg-slate-50">
          <ProcessCanvas
            graph={state.graph}
            actors={actors.data ?? []}
            issues={issues}
            selection={state.selection}
            readOnly={readOnly}
            dispatch={dispatch}
            fitSignal={fitSignal}
          />
        </div>
        <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white 2xl:w-96">
          <div role="tablist" className="flex shrink-0 border-b border-slate-200 text-sm">
            {(
              [
                ['properties', 'Properties', null],
                ['validation', 'Validation', issues.length],
                ['findings', 'Findings', state.findings.filter((f) => f.status === 'draft').length],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={clsx(
                  '-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 font-medium',
                  tab === id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800',
                )}
              >
                {label}
                {count ? (
                  <span
                    className={clsx(
                      'rounded-full px-1.5 text-[10px]',
                      id === 'validation' && errorCount > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800',
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'properties' ? (
              <PropertiesPanel
                projectId={project.id}
                graph={state.graph}
                actors={actors.data ?? []}
                selection={state.selection}
                readOnly={readOnly}
                dispatch={dispatch}
              />
            ) : tab === 'validation' ? (
              <ValidationPanel issues={issues} dispatch={dispatch} />
            ) : (
              <FindingsPanel findings={state.findings} graph={state.graph} readOnly={readOnly} dispatch={dispatch} />
            )}
          </div>
        </aside>
      </div>

      {proposal ? (
        <ProposalDialog
          response={proposal}
          existingActors={actors.data ?? []}
          replacesExistingMap={state.graph.nodes.length > 0}
          onAccept={() => acceptProposal(proposal)}
          onDiscard={() => setProposal(null)}
        />
      ) : null}

      <ApproveDialog
        open={approving}
        versionNumber={version.version_number}
        issues={issues}
        onApprove={approve}
        onClose={() => setApproving(false)}
      />

      <ProcessDetailsDialog
        open={editingDetails}
        onClose={() => setEditingDetails(false)}
        detail={detail}
        projectId={project.id}
        readOnly={!canEdit}
      />

      <Dialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Leave without saving?"
        description="You have unsaved changes to this process map."
        footer={
          <>
            <Button onClick={() => blocker.reset?.()}>Stay</Button>
            <Button
              variant="danger"
              onClick={() => {
                clearDraftBackup(version.id);
                blocker.proceed?.();
              }}
            >
              Discard changes
            </Button>
            <Button
              variant="primary"
              loading={saving}
              onClick={async () => {
                if (await save()) blocker.proceed?.();
                else blocker.reset?.();
              }}
            >
              Save first
            </Button>
          </>
        }
      />
    </div>
  );
}

function ProcessDetailsDialog({
  open,
  onClose,
  detail,
  projectId,
  readOnly,
}: {
  open: boolean;
  onClose: () => void;
  detail: ProcessDetail;
  projectId: string;
  readOnly: boolean;
}) {
  const update = useUpdateProcessDetails(detail.process.id, projectId);
  const initial: ProcessDetails = {
    name: detail.process.name,
    processType: detail.process.process_type,
    owner: detail.process.owner,
    businessUnit: detail.process.business_unit,
  };
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Process details"
      description="Details apply to the process as a whole, not to a single version. Changes are recorded in the audit log."
      footer={
        readOnly ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={update.isPending}
              disabled={!value.name.trim()}
              onClick={() => update.mutate(value, { onSuccess: onClose })}
            >
              Save details
            </Button>
          </>
        )
      }
    >
      {update.error ? (
        <Alert tone="error" className="mb-4">
          {errorMessage(update.error)}
        </Alert>
      ) : null}
      <ProcessDetailsFields value={value} onChange={setValue} disabled={readOnly} />
    </Dialog>
  );
}
