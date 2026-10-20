import {
  applyDataProposal,
  can,
  dataActivities,
  NODE_TYPE_LABELS,
  PROJECT_ROLE_LABELS,
  toSaveDataPayload,
  validateDataRequirements,
  type DataProposal,
  type ProcessVersionRow,
} from '@productflow/domain';
import { useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertTriangle, ArrowLeft, Save, Sparkles, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import { Alert, Badge, Button, Dialog, Select, Spinner } from '../../components/ui';
import { backend, type VersionData } from '../../lib/backend';
import { errorMessage, isConflict } from '../../lib/errors';
import { useActors, useProcessDetail, useVersionContent, type ProcessDetail, type VersionContent } from '../process-designer/api';
import { VersionStatusBadge } from '../processes/VersionStatusBadge';
import { useProject, type ProjectWithRole } from '../projects/api';
import { ActivityDataPanel } from './ActivityDataPanel';
import { dataKeys, useCreateFields, useFields, useValidationRules, useVersionData } from './api';
import { DataProposalDialog } from './DataProposalDialog';
import { FieldDialog } from './FieldDialog';
import { ioReducer, type IoState } from './io-state';

function defaultVersionId(versions: ProcessVersionRow[]): string | null {
  return (versions.find((v) => v.status === 'draft') ?? versions[0])?.id ?? null;
}

export function IoEditorPage() {
  const { projectId = '', processId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const project = useProject(projectId);
  const detail = useProcessDetail(processId);
  const versions = detail.data?.versions ?? [];
  const requested = searchParams.get('version');
  const versionId = requested && versions.some((v) => v.id === requested) ? requested : defaultVersionId(versions);
  const content = useVersionContent(versionId);
  const data = useVersionData(versionId);
  const [reloadToken, setReloadToken] = useState(0);

  if (detail.isPending || project.isPending || (versionId && (content.isPending || data.isPending))) {
    return <Spinner label="Loading data requirements…" className="h-full" />;
  }
  const error = detail.error ?? project.error ?? content.error ?? data.error;
  if (error) {
    return (
      <div className="p-8">
        <Alert tone="error" title="Could not load the data requirements">
          {errorMessage(error)}
        </Alert>
      </div>
    );
  }
  if (!detail.data || !project.data || !content.data || !data.data) {
    return (
      <div className="p-8">
        <Alert tone="warning" title="Process not found">
          It may have been removed, or you may not have access to it.
        </Alert>
      </div>
    );
  }
  return (
    <IoWorkspace
      key={`${content.data.version.id}:${reloadToken}`}
      project={project.data}
      detail={detail.data}
      content={content.data}
      data={data.data}
      initialActivity={searchParams.get('activity')}
      onReload={async () => {
        await Promise.all([content.refetch(), data.refetch(), detail.refetch()]);
        setReloadToken((t) => t + 1);
      }}
    />
  );
}

function IoWorkspace({
  project,
  detail,
  content,
  data,
  initialActivity,
  onReload,
}: {
  project: ProjectWithRole;
  detail: ProcessDetail;
  content: VersionContent;
  data: VersionData;
  initialActivity: string | null;
  onReload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const version = content.version;
  const graph = content.graph;
  const actors = useActors(project.id);
  const fields = useFields(project.id);
  const rules = useValidationRules(project.id);
  const createFields = useCreateFields(project.id);
  const canEdit = can(project.role, 'editData');
  const readOnly = version.status !== 'draft' || !canEdit;

  const [state, dispatch] = useReducer(ioReducer, null, (): IoState => ({
    versionId: version.id,
    dataRevision: data.dataRevision,
    requirements: data.requirements,
    dirty: false,
  }));
  const activities = useMemo(() => dataActivities(graph), [graph]);
  const [selected, setSelected] = useState<string | null>(
    () => activities.find((a) => a.elementKey === initialActivity)?.elementKey ?? activities[0]?.elementKey ?? null,
  );
  const [openField, setOpenField] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [suggesting, setSuggesting] = useState<'one' | 'all' | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ proposal: DataProposal; model: string } | null>(null);

  const issues = useMemo(
    () =>
      validateDataRequirements({ graph, requirements: state.requirements, fields: fields.data ?? [], rules: rules.data ?? [] }),
    [graph, state.requirements, fields.data, rules.data],
  );
  const node = activities.find((a) => a.elementKey === selected) ?? null;

  const save = useCallback(async (): Promise<boolean> => {
    if (readOnly || saving) return false;
    if (!state.dirty) return true;
    setSaving(true);
    setSaveError(null);
    const sent = state.requirements;
    try {
      const revision = await backend.saveVersionData(
        toSaveDataPayload({
          versionId: version.id,
          expectedRevision: state.dataRevision,
          requirements: sent,
          nodeKeys: new Set(graph.nodes.map((n) => n.elementKey)),
        }),
      );
      dispatch({ type: 'saved', dataRevision: revision, requirements: sent });
      qc.setQueryData(dataKeys.version(version.id), { dataRevision: revision, requirements: sent });
      void qc.invalidateQueries({ queryKey: dataKeys.usages(project.id) });
      return true;
    } catch (err) {
      setSaveError({ message: errorMessage(err), conflict: isConflict(err) });
      return false;
    } finally {
      setSaving(false);
    }
  }, [readOnly, saving, state, version.id, graph.nodes, qc, project.id]);

  // Unsaved changes: guard navigation inside the app and closing the tab.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      state.dirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (!state.dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  async function suggest(scope: 'one' | 'all') {
    setSuggesting(scope);
    setSuggestError(null);
    try {
      const response = await backend.suggestFields({
        versionId: version.id,
        nodeKeys: scope === 'one' && selected ? [selected] : undefined,
      });
      setProposal({ proposal: response.proposal, model: response.model });
    } catch (err) {
      setSuggestError(errorMessage(err));
    } finally {
      setSuggesting(null);
    }
  }

  async function acceptProposal(p: DataProposal, selection: { fieldKeys: Set<string>; outputKeys: Set<string> }) {
    const items = p.fields.filter((f) => selection.fieldKeys.has(f.key) && !f.alreadyMapped);
    const neededKeys = new Set(items.map((i) => i.newFieldKey).filter((k): k is string => Boolean(k)));
    const drafts = p.newFields.filter((f) => neededKeys.has(f.key));
    const created = await createFields.mutateAsync(drafts.map((d) => ({ ...d, defaultValue: '', status: 'draft' as const })));
    const fieldIdByNewKey = new Map(drafts.map((d, i) => [d.key, created[i]!.id]));
    dispatch({
      type: 'set',
      requirements: applyDataProposal(state.requirements, {
        fields: items,
        outputs: p.outputs.filter((o) => selection.outputKeys.has(o.key)),
        fieldIdByNewKey,
      }),
    });
    setProposal(null);
  }

  const readOnlyReason =
    version.status !== 'draft'
      ? `Version ${version.version_number} is ${version.status}, so its data requirements cannot change.`
      : !canEdit
        ? `You have read-only access as ${PROJECT_ROLE_LABELS[project.role]}.`
        : null;
  const openDraft = detail.versions.find((v) => v.status === 'draft');
  const counts = (key: string) => ({
    inputs: state.requirements.fields.filter((f) => f.nodeKey === key && f.direction === 'input').length,
    outputs:
      state.requirements.fields.filter((f) => f.nodeKey === key && f.direction === 'output').length +
      state.requirements.outputs.filter((o) => o.nodeKey === key).length,
  });
  const severityOf = (key: string) => {
    const own = issues.filter((i) => i.nodeKeys.includes(key));
    return own.some((i) => i.severity === 'error') ? 'error' : own.length > 0 ? 'warning' : null;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <Link
          to={`/projects/${project.id}/data`}
          className="text-slate-400 hover:text-slate-700"
          aria-label="Back to data requirements"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <p className="text-xs text-slate-500">Inputs &amp; outputs</p>
          <h1 className="truncate text-base font-semibold text-slate-900">
            <span className="mr-2 font-mono text-xs font-normal text-slate-500">{detail.process.ref_code}</span>
            {detail.process.name}
          </h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            aria-label="Version"
            className="h-8 w-48 text-xs"
            value={version.id}
            onChange={(e) => navigate(`?version=${e.target.value}`)}
          >
            {detail.versions.map((v) => (
              <option key={v.id} value={v.id}>
                Version {v.version_number} ·{' '}
                {v.status === 'draft' ? 'Draft' : v.status === 'approved' ? 'Approved' : 'Superseded'}
              </option>
            ))}
          </Select>
          <VersionStatusBadge status={version.status} />
          {readOnly ? null : (
            <>
              <span className={clsx('text-xs', state.dirty ? 'text-amber-700' : 'text-slate-400')} aria-live="polite">
                {saving ? 'Saving…' : state.dirty ? 'Unsaved changes' : 'All changes saved'}
              </span>
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
          )}
        </div>
      </div>

      <div className="space-y-2 empty:hidden [&>*]:mx-4 [&>*:first-child]:mt-2">
        {readOnlyReason ? (
          <Alert
            action={
              openDraft && openDraft.id !== version.id ? (
                <Button size="sm" onClick={() => navigate(`?version=${openDraft.id}`)}>
                  Open draft v{openDraft.version_number}
                </Button>
              ) : undefined
            }
          >
            {readOnlyReason}
            {version.status !== 'draft' && !openDraft && canEdit
              ? ' Create a new draft in the Process Designer to change them.'
              : null}
          </Alert>
        ) : null}
        {saveError ? (
          <Alert
            tone="error"
            title={saveError.conflict ? 'Someone else saved these inputs and outputs' : 'Save failed'}
            action={
              saveError.conflict ? (
                <Button size="sm" onClick={() => void onReload()}>
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

      {activities.length === 0 ? (
        <div className="p-8">
          <Alert tone="warning" title="No activities yet">
            This version's process map has no activities. Create the map in the Process Designer first.
          </Alert>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            aria-label="Activities"
            className="shrink-0 overflow-y-auto border-b border-slate-200 bg-white md:w-72 md:border-r md:border-b-0"
          >
            <ul className="divide-y divide-slate-100">
              {activities.map((a) => {
                const c = counts(a.elementKey);
                const severity = severityOf(a.elementKey);
                return (
                  <li key={a.elementKey}>
                    <button
                      type="button"
                      onClick={() => setSelected(a.elementKey)}
                      aria-current={selected === a.elementKey ? 'true' : undefined}
                      className={clsx(
                        'flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-slate-50',
                        selected === a.elementKey && 'bg-brand-50 hover:bg-brand-50',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] text-slate-400">
                          <span className="font-mono">{a.refCode ?? 'new'}</span> · {NODE_TYPE_LABELS[a.type]}
                        </span>
                        <span className="block truncate text-sm font-medium text-slate-800">{a.label}</span>
                        <span className="text-[11px] text-slate-500">
                          {c.inputs} in · {c.outputs} out
                        </span>
                      </span>
                      {severity === 'error' ? (
                        <XCircle className="mt-1 size-3.5 shrink-0 text-red-600" aria-label="Has errors" />
                      ) : null}
                      {severity === 'warning' ? (
                        <AlertTriangle className="mt-1 size-3.5 shrink-0 text-amber-500" aria-label="Has warnings" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <main className="min-w-0 flex-1 overflow-y-auto bg-white p-4 sm:p-6">
            {node ? (
              <ActivityDataPanel
                projectId={project.id}
                processId={detail.process.id}
                versionId={version.id}
                node={node}
                graph={graph}
                actors={actors.data ?? []}
                state={state}
                fields={fields.data ?? []}
                rules={rules.data ?? []}
                readOnly={readOnly}
                dispatch={dispatch}
                onOpenField={setOpenField}
              />
            ) : null}
          </main>

          <aside className="shrink-0 space-y-4 overflow-y-auto border-t border-slate-200 bg-slate-50 p-4 md:w-80 md:border-t-0 md:border-l">
            {readOnly ? null : (
              <section className="space-y-2 rounded-md border border-violet-200 bg-white p-3">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Sparkles className="size-4 text-violet-600" /> Suggest with AI
                </h2>
                <p className="text-xs text-slate-500">
                  Claude proposes fields and outputs from the process description and map. You choose what to add; new fields
                  start as drafts.
                </p>
                {suggestError ? <Alert tone="error">{suggestError}</Alert> : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    loading={suggesting === 'one'}
                    disabled={!node || suggesting !== null}
                    onClick={() => void suggest('one')}
                  >
                    For this activity
                  </Button>
                  <Button
                    size="sm"
                    loading={suggesting === 'all'}
                    disabled={suggesting !== null}
                    onClick={() => void suggest('all')}
                  >
                    For all activities
                  </Button>
                </div>
                {suggesting ? (
                  <p className="text-xs text-slate-500">Claude is reading the process. This can take up to a minute.</p>
                ) : null}
              </section>
            )}
            <section>
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                Checks{' '}
                {issues.length > 0 ? (
                  <Badge tone={issues.some((i) => i.severity === 'error') ? 'red' : 'amber'}>{issues.length}</Badge>
                ) : null}
              </h2>
              {issues.length === 0 ? (
                <p className="text-xs text-slate-500">Every activity has data and every field is confirmed.</p>
              ) : (
                <ul className="space-y-1.5">
                  {issues.map((issue) => (
                    <li key={issue.id}>
                      <button
                        type="button"
                        onClick={() => {
                          const key = issue.nodeKeys.find((k) => activities.some((a) => a.elementKey === k));
                          if (key) setSelected(key);
                          else if (issue.fieldIds[0]) setOpenField(issue.fieldIds[0]);
                        }}
                        className={clsx(
                          'flex w-full gap-2 rounded-md border px-2.5 py-2 text-left text-xs',
                          issue.severity === 'error'
                            ? 'border-red-200 bg-red-50 text-red-900'
                            : 'border-amber-200 bg-amber-50 text-amber-900',
                        )}
                      >
                        {issue.severity === 'error' ? (
                          <XCircle className="mt-px size-3.5 shrink-0 text-red-600" />
                        ) : (
                          <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-600" />
                        )}
                        <span>{issue.message}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}

      {proposal ? (
        <DataProposalDialog
          proposal={proposal.proposal}
          model={proposal.model}
          graph={graph}
          fields={fields.data ?? []}
          onClose={() => setProposal(null)}
          onAccept={(selection) => acceptProposal(proposal.proposal, selection)}
        />
      ) : null}

      <FieldDialog projectId={project.id} fieldId={openField} readOnly={!canEdit} onClose={() => setOpenField(null)} />

      <Dialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Leave without saving?"
        description="You have unsaved changes to these inputs and outputs."
        footer={
          <>
            <Button onClick={() => blocker.reset?.()}>Stay</Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
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
