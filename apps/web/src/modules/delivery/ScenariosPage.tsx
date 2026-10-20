import {
  canDeliver,
  newestExecutionFirst,
  SCENARIO_TYPE_LABELS,
  SCENARIO_TYPES,
  scenarioReadiness,
  scenarioUatStatus,
  type BusinessScenario,
  type DeliverySnapshot,
  type ProjectContext,
  type ProjectRole,
  type ScenarioProposal,
  type ScenarioStep,
  type ScenarioType,
} from '@productflow/domain';
import { ClipboardList, Flag, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, Badge, Button, Dialog, EmptyState, Field, IconButton, Input, Select, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useDelivery, useDeliveryAi, useDeliveryOp, type Lookups } from './api';
import { AiGeneratedBadge, DeliveryPage, History, ItemListEditor, LinkPicker, Loading, UatBadge } from './shared';

type ScenarioContent = ScenarioProposal['scenarios'][number];

const blank = (): ScenarioContent => ({
  title: '',
  scenarioType: 'main',
  description: '',
  processId: null,
  activities: [],
  preconditions: [],
  steps: [],
  storyIds: [],
  prerequisites: '',
});

const contentOf = (s: BusinessScenario): ScenarioContent => ({
  title: s.title,
  scenarioType: s.scenarioType,
  description: s.description,
  processId: s.processId,
  activities: s.activities,
  preconditions: s.preconditions,
  steps: s.steps,
  storyIds: s.storyIds,
  prerequisites: s.prerequisites,
});

/** Business User Story: end-to-end business scenarios for UAT, greyed out until their technical stories are completed. */
export function ScenariosPage() {
  const { projectId = '' } = useParams();
  const { role, snapshot, context, lookups, isPending, error } = useDelivery(projectId);
  const [open, setOpen] = useState<BusinessScenario | 'new' | null>(null);
  const [generating, setGenerating] = useState(false);
  const [proposal, setProposal] = useState<ScenarioProposal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = canDeliver(role, 'editScenarios');

  return (
    <DeliveryPage
      projectId={projectId}
      module="Business User Story"
      title="Business scenarios"
      description="End-to-end scenarios for user acceptance testing. A scenario becomes Ready for UAT when it is approved, its technical stories are completed and its prerequisites are met."
      actions={
        canEdit ? (
          <div className="flex gap-2">
            <Button icon={<Sparkles className="size-4" />} onClick={() => setGenerating(true)}>
              Generate from stories
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen('new')}>
              New scenario
            </Button>
          </div>
        ) : undefined
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
          {snapshot.scenarios.length === 0 ? (
            <EmptyState icon={<ClipboardList className="size-8" />} title="No business scenarios yet">
              Generate scenarios from functional stories, or write one.
            </EmptyState>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[...snapshot.scenarios]
                .sort((a, b) => a.refCode.localeCompare(b.refCode, undefined, { numeric: true }))
                .map((sc) => {
                  const readiness = scenarioReadiness(sc, new Map(snapshot.stories.map((s) => [s.id, s])));
                  const uat = scenarioUatStatus(sc, snapshot.executions, readiness);
                  return (
                    <li key={sc.id}>
                      <button
                        type="button"
                        onClick={() => setOpen(sc)}
                        className={cn(
                          'h-full w-full rounded-lg border p-4 text-left shadow-sm hover:border-brand-500',
                          uat === 'not_ready' ? 'border-slate-200 bg-slate-100 text-slate-500' : 'border-slate-200 bg-white',
                        )}
                        aria-label={`${sc.refCode} ${sc.title}`}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs">{sc.refCode}</span>
                          <Badge>{SCENARIO_TYPE_LABELS[sc.scenarioType]}</Badge>
                          <UatBadge status={uat} />
                          {sc.status === 'draft' ? <Badge tone="amber">Draft</Badge> : null}
                          {sc.origin !== 'manual' ? <AiGeneratedBadge /> : null}
                          {sc.reviewFlag ? (
                            <Badge tone="red" title={sc.reviewFlag}>
                              <Flag className="size-3" /> Review
                            </Badge>
                          ) : null}
                        </div>
                        <p className={cn('mt-1.5 font-medium', uat === 'not_ready' ? 'text-slate-600' : 'text-slate-900')}>
                          {sc.title}
                        </p>
                        <p className="mt-1 text-xs">
                          {sc.steps.length} steps · Needs{' '}
                          {sc.storyIds.map((id) => snapshot.stories.find((s) => s.id === id)?.refCode).join(', ') ||
                            'no stories linked'}
                        </p>
                        {!readiness.ready ? (
                          <p className="mt-1.5 text-xs text-slate-500">{readiness.reasons.join('. ')}.</p>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}
          {open ? (
            <ScenarioDialog
              projectId={projectId}
              scenario={open === 'new' ? null : (snapshot.scenarios.find((s) => s.id === open.id) ?? open)}
              role={role}
              snapshot={snapshot}
              context={context}
              lookups={lookups}
              onClose={() => setOpen(null)}
            />
          ) : null}
          {generating ? (
            <GenerateScenariosDialog
              projectId={projectId}
              snapshot={snapshot}
              onClose={() => setGenerating(false)}
              onProposal={(p) => {
                setGenerating(false);
                setProposal(p);
              }}
            />
          ) : null}
          {proposal ? (
            <ScenarioProposalDialog
              projectId={projectId}
              proposal={proposal}
              snapshot={snapshot}
              onClose={() => setProposal(null)}
              onCreated={(n) => {
                setProposal(null);
                setNotice(`${n} scenario${n === 1 ? '' : 's'} added as drafts.`);
              }}
            />
          ) : null}
        </>
      ) : null}
    </DeliveryPage>
  );
}

function GenerateScenariosDialog({
  projectId,
  snapshot,
  onClose,
  onProposal,
}: {
  projectId: string;
  snapshot: DeliverySnapshot;
  onClose: () => void;
  onProposal: (p: ScenarioProposal) => void;
}) {
  const functional = snapshot.stories.filter((s) => s.storyType === 'functional' && s.status !== 'draft');
  const [selected, setSelected] = useState<string[]>(functional.slice(0, 1).map((s) => s.id));
  const generate = useDeliveryAi('generateScenarios');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Generate business scenarios"
      description="Claude writes main, alternative and exception scenarios from the stories you choose and links them to the technical stories that implement them."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon={<Sparkles className="size-4" />}
            loading={generate.isPending}
            disabled={selected.length === 0}
            onClick={() => generate.mutate({ input: { projectId, storyIds: selected } }, { onSuccess: onProposal })}
          >
            Generate scenarios
          </Button>
        </>
      }
    >
      <LinkPicker
        label="Functional stories"
        options={functional}
        selected={selected}
        onChange={setSelected}
        render={(s) => `${s.refCode} ${s.title}`}
        empty="Submit or approve functional stories first."
      />
      {generate.error ? (
        <Alert tone="error" className="mt-3">
          {errorMessage(generate.error)}
        </Alert>
      ) : null}
    </Dialog>
  );
}

function ScenarioProposalDialog({
  projectId,
  proposal,
  snapshot,
  onClose,
  onCreated,
}: {
  projectId: string;
  proposal: ScenarioProposal;
  snapshot: DeliverySnapshot;
  onClose: () => void;
  onCreated: (n: number) => void;
}) {
  const [selected, setSelected] = useState(() => new Set(proposal.scenarios.map((_, i) => i)));
  const create = useDeliveryOp(projectId, 'createScenarios');
  return (
    <Dialog
      open
      size="xl"
      onClose={onClose}
      title="Review suggested scenarios"
      description={`From ${proposal.model}. Tick the scenarios to keep; they are added as drafts.`}
      footer={
        <>
          <Button onClick={onClose}>Discard</Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={selected.size === 0}
            onClick={() =>
              create.mutate(
                {
                  projectId,
                  scenarios: proposal.scenarios
                    .filter((_, i) => selected.has(i))
                    .map((content) => ({ content, origin: 'inferred' })),
                },
                { onSuccess: (c) => onCreated(c.length) },
              )
            }
          >
            Add {selected.size} as drafts
          </Button>
        </>
      }
    >
      {proposal.questions.length ? (
        <Alert tone="warning" title="Questions for you" className="mb-3">
          {proposal.questions.join(' ')}
        </Alert>
      ) : null}
      <ul className="space-y-3">
        {proposal.scenarios.map((sc, i) => (
          <li key={i} className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                aria-label={`Keep ${sc.title}`}
                checked={selected.has(i)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(i);
                  else next.delete(i);
                  setSelected(next);
                }}
              />
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{sc.title}</span>
                  <Badge>{SCENARIO_TYPE_LABELS[sc.scenarioType]}</Badge>
                </div>
                <p className="text-slate-600">{sc.description}</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-slate-700">
                  {sc.steps.map((st) => (
                    <li key={st.id}>
                      {st.action} → <i>{st.expectedResult}</i>
                    </li>
                  ))}
                </ol>
                <p className="mt-1 text-xs text-slate-500">
                  Needs{' '}
                  {sc.storyIds.map((id) => snapshot.stories.find((s) => s.id === id)?.refCode).join(', ') ||
                    'no technical stories yet'}
                </p>
              </div>
            </label>
          </li>
        ))}
      </ul>
      {create.error ? (
        <Alert tone="error" className="mt-3">
          {errorMessage(create.error)}
        </Alert>
      ) : null}
    </Dialog>
  );
}

function StepsEditor({
  steps,
  onChange,
  disabled,
}: {
  steps: ScenarioStep[];
  onChange: (s: ScenarioStep[]) => void;
  disabled: boolean;
}) {
  const set = (id: string, patch: Partial<ScenarioStep>) => onChange(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-slate-600">Steps</legend>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="w-8 py-1">#</th>
              <th className="py-1 pr-1">User action</th>
              <th className="py-1 pr-1">Input data</th>
              <th className="py-1 pr-1">Expected behaviour</th>
              <th className="py-1 pr-1">Expected result</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {steps.map((st, i) => (
              <tr key={st.id} className="align-top">
                <td className="py-1 text-xs text-slate-400">{i + 1}</td>
                {(['action', 'inputData', 'expectedBehaviour', 'expectedResult'] as const).map((k) => (
                  <td key={k} className="py-1 pr-1">
                    {disabled ? (
                      <p className="text-sm">{st[k]}</p>
                    ) : (
                      <Textarea
                        aria-label={`Step ${i + 1} ${k}`}
                        rows={2}
                        className="text-xs"
                        value={st[k]}
                        onChange={(e) => set(st.id, { [k]: e.target.value })}
                      />
                    )}
                  </td>
                ))}
                <td className="py-1">
                  {disabled ? null : (
                    <IconButton
                      label={`Remove step ${i + 1}`}
                      icon={<Trash2 className="size-3.5" />}
                      onClick={() => onChange(steps.filter((s) => s.id !== st.id))}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled ? (
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus className="size-3.5" />}
          onClick={() =>
            onChange([
              ...steps,
              { id: globalThis.crypto.randomUUID(), action: '', inputData: '', expectedBehaviour: '', expectedResult: '' },
            ])
          }
        >
          Add step
        </Button>
      ) : null}
    </fieldset>
  );
}

function ScenarioDialog({
  projectId,
  scenario,
  role,
  snapshot,
  context,
  lookups,
  onClose,
}: {
  projectId: string;
  scenario: BusinessScenario | null;
  role: ProjectRole | null;
  snapshot: DeliverySnapshot;
  context: ProjectContext;
  lookups: Lookups;
  onClose: () => void;
}) {
  const [content, setContent] = useState<ScenarioContent>(() => (scenario ? contentOf(scenario) : blank()));
  const [prereq, setPrereq] = useState(scenario?.prerequisites ?? '');
  const create = useDeliveryOp(projectId, 'createScenarios');
  const update = useDeliveryOp(projectId, 'updateScenario');
  const status = useDeliveryOp(projectId, 'setScenarioStatus');
  const prerequisites = useDeliveryOp(projectId, 'setPrerequisites');
  const remove = useDeliveryOp(projectId, 'deleteScenario');
  const clearFlag = useDeliveryOp(projectId, 'clearReviewFlag');
  const failed = create.error ?? update.error ?? status.error ?? prerequisites.error ?? remove.error ?? clearFlag.error;
  const editable = canDeliver(role, 'editScenarios') && (!scenario || scenario.status === 'draft');
  const dirty = !scenario || JSON.stringify(contentOf(scenario)) !== JSON.stringify(content);
  const technical = snapshot.stories.filter((s) => s.storyType === 'technical');
  const activities = [...lookups.activities.values()].map((a) => ({ id: `${a.processId}|${a.nodeKey}`, ...a }));
  const readiness = scenario ? scenarioReadiness(scenario, new Map(snapshot.stories.map((s) => [s.id, s]))) : null;
  const runs = scenario ? snapshot.executions.filter((e) => e.scenarioId === scenario.id).sort(newestExecutionFirst) : [];
  const set = <K extends keyof ScenarioContent>(k: K, v: ScenarioContent[K]) => setContent((c) => ({ ...c, [k]: v }));

  return (
    <Dialog
      open
      size="xl"
      onClose={onClose}
      title={scenario ? `${scenario.refCode} ${scenario.title}` : 'New business scenario'}
      description={
        scenario && readiness ? (
          <span className="flex flex-wrap items-center gap-2">
            <UatBadge status={scenarioUatStatus(scenario, snapshot.executions, readiness)} />
            <Badge tone={scenario.status === 'approved' ? 'green' : 'amber'}>
              {scenario.status === 'approved' ? 'Approved' : 'Draft'}
            </Badge>
            <span className="text-xs text-slate-400">Version {scenario.version}</span>
          </span>
        ) : undefined
      }
      footer={
        <>
          {scenario && editable ? (
            <Button
              variant="danger"
              className="mr-auto"
              icon={<Trash2 className="size-4" />}
              onClick={() => remove.mutate({ scenarioId: scenario.id }, { onSuccess: onClose })}
            >
              Delete
            </Button>
          ) : null}
          {scenario?.status === 'draft' && canDeliver(role, 'approveScenario') ? (
            <Button
              disabled={dirty}
              title={dirty ? 'Save first' : undefined}
              loading={status.isPending}
              onClick={() => status.mutate({ scenarioId: scenario.id, revision: scenario.revision, status: 'approved' })}
            >
              Approve
            </Button>
          ) : null}
          {scenario?.status === 'approved' && (canDeliver(role, 'editScenarios') || canDeliver(role, 'approveScenario')) ? (
            <Button
              loading={status.isPending}
              onClick={() => status.mutate({ scenarioId: scenario.id, revision: scenario.revision, status: 'draft' })}
            >
              Return to draft
            </Button>
          ) : null}
          <Button onClick={onClose}>Close</Button>
          {editable ? (
            <Button
              variant="primary"
              disabled={!dirty || !content.title.trim()}
              loading={create.isPending || update.isPending}
              onClick={() =>
                scenario
                  ? update.mutate({ scenarioId: scenario.id, revision: scenario.revision, content })
                  : create.mutate({ projectId, scenarios: [{ content, origin: 'manual' }] }, { onSuccess: onClose })
              }
            >
              {scenario ? 'Save changes' : 'Create scenario'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {failed ? <Alert tone="error">{errorMessage(failed)}</Alert> : null}
          {scenario?.reviewFlag ? (
            <Alert
              tone="warning"
              title="Review needed after a process change"
              action={
                <Button size="sm" onClick={() => clearFlag.mutate({ entityType: 'scenario', id: scenario.id })}>
                  Mark reviewed
                </Button>
              }
            >
              {scenario.reviewFlag}
            </Alert>
          ) : null}
          {readiness && !readiness.ready ? (
            <Alert tone="info" title="Not ready for testing">
              {readiness.reasons.join('. ')}.
            </Alert>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
            <Field label="Title">
              {(id) => (
                <Input id={id} value={content.title} disabled={!editable} onChange={(e) => set('title', e.target.value)} />
              )}
            </Field>
            <Field label="Scenario type">
              {(id) => (
                <Select
                  id={id}
                  value={content.scenarioType}
                  disabled={!editable}
                  onChange={(e) => set('scenarioType', e.target.value as ScenarioType)}
                >
                  {SCENARIO_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {SCENARIO_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Description">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={content.description}
                disabled={!editable}
                onChange={(e) => set('description', e.target.value)}
              />
            )}
          </Field>
          <ItemListEditor
            label="Preconditions"
            items={content.preconditions}
            disabled={!editable}
            onChange={(v) => set('preconditions', v)}
          />
          <StepsEditor steps={content.steps} disabled={!editable} onChange={(v) => set('steps', v)} />
          {runs.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Test history</p>
              <ul className="space-y-1 text-sm">
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link className="text-brand-700 hover:underline" to={`/projects/${projectId}/testing/${r.id}`}>
                      {r.refCode}
                    </Link>{' '}
                    {r.status.replace('_', ' ')} · v{r.scenarioVersion} · {lookups.memberName(r.testerId)} ·{' '}
                    {new Date(r.startedAt).toLocaleString()}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <aside className="space-y-4">
          <LinkPicker
            label="Technical stories it needs"
            options={technical}
            selected={content.storyIds}
            disabled={!editable}
            onChange={(v) => set('storyIds', v)}
            render={(s) => `${s.refCode} ${s.title} (${s.workStatus.replace(/_/g, ' ')})`}
          />
          <LinkPicker
            label="Activities tested"
            options={activities}
            selected={content.activities.map((a) => `${a.processId}|${a.nodeKey}`)}
            disabled={!editable}
            onChange={(sel) =>
              set(
                'activities',
                sel.map((s) => ({ processId: s.split('|')[0]!, nodeKey: s.split('|')[1]! })),
              )
            }
            render={(a) => `${a.processRef} · ${a.refCode ?? ''} ${a.label}`}
          />
          <Field label="Process">
            {(id) => (
              <Select
                id={id}
                value={content.processId ?? ''}
                disabled={!editable}
                onChange={(e) => set('processId', e.target.value || null)}
              >
                <option value="">None</option>
                {context.processes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ref_code} {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {scenario ? (
            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              <Field label="Prerequisites (test data, access, environment)">
                {(id) => <Textarea id={id} rows={2} value={prereq} onChange={(e) => setPrereq(e.target.value)} />}
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scenario.prerequisitesMet}
                  disabled={!(canDeliver(role, 'editScenarios') || canDeliver(role, 'executeTests'))}
                  onChange={(e) =>
                    prerequisites.mutate({
                      scenarioId: scenario.id,
                      revision: scenario.revision,
                      prerequisites: prereq,
                      met: e.target.checked,
                    })
                  }
                />
                Prerequisites are met
              </label>
            </div>
          ) : (
            <Field label="Prerequisites">
              {(id) => (
                <Textarea id={id} rows={2} value={content.prerequisites} onChange={(e) => set('prerequisites', e.target.value)} />
              )}
            </Field>
          )}
        </aside>
      </div>
      {scenario ? (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <History
            projectId={projectId}
            entityType="scenario"
            entityId={scenario.id}
            events={snapshot.events}
            lookups={lookups}
          />
        </div>
      ) : null}
    </Dialog>
  );
}
