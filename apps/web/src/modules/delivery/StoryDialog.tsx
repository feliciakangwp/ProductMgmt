import {
  canDeliver,
  canEditStory,
  checkStoryStatusChange,
  EMPTY_STORY_CONTENT,
  STORY_CONTENT_KEYS,
  STORY_TYPE_LABELS,
  storyReadinessProblems,
  type DeliverySnapshot,
  type ProjectContext,
  type ProjectRole,
  type RefinementProposal,
  type Story,
  type StoryContent,
  type StoryProposal,
  type StoryStatus,
  type StoryType,
  type TextItem,
} from '@productflow/domain';
import { CheckCircle2, Flag, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Dialog, Field, Input, Textarea } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useDeliveryAi, useDeliveryOp, type Lookups } from './api';
import { AiGeneratedBadge, History, ItemListEditor, LinkPicker, StoryStatusBadge, WorkStatusBadge } from './shared';
import { StoryProposalDialog } from './StoryProposalDialog';

const ids = () => globalThis.crypto.randomUUID();
const toItems = (texts: string[]): TextItem[] => texts.map((text) => ({ id: ids(), text }));

function contentOf(story: Story | null): StoryContent {
  if (!story) return { ...EMPTY_STORY_CONTENT };
  return Object.fromEntries(STORY_CONTENT_KEYS.map((k) => [k, story[k]])) as StoryContent;
}

const ACTIONS: { to: StoryStatus; from: StoryStatus[]; label: string; primary?: boolean }[] = [
  { to: 'pending_review', from: ['draft'], label: 'Submit for review', primary: true },
  { to: 'approved', from: ['pending_review'], label: 'Approve', primary: true },
  { to: 'draft', from: ['pending_review'], label: 'Return to draft' },
  { to: 'in_backlog', from: ['approved'], label: 'Add to backlog', primary: true },
  { to: 'draft', from: ['approved', 'in_backlog'], label: 'Reopen for changes' },
];

/** Create, edit, review and trace one functional or technical story. */
export function StoryDialog({
  projectId,
  story,
  newType,
  role,
  snapshot,
  context,
  lookups,
  onClose,
}: {
  projectId: string;
  story: Story | null;
  newType?: StoryType;
  role: ProjectRole | null;
  snapshot: DeliverySnapshot;
  context: ProjectContext;
  lookups: Lookups;
  onClose: () => void;
}) {
  const type: StoryType = story?.storyType ?? newType ?? 'functional';
  const [content, setContent] = useState<StoryContent>(() => contentOf(story));
  const [designStatus, setDesignStatus] = useState(story?.designStatus ?? 'confirmed');
  const [comment, setComment] = useState('');
  const [refinement, setRefinement] = useState<RefinementProposal | null>(null);
  const [techProposal, setTechProposal] = useState<StoryProposal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const create = useDeliveryOp(projectId, 'createStory');
  const update = useDeliveryOp(projectId, 'updateStory');
  const setStatus = useDeliveryOp(projectId, 'setStoryStatus');
  const remove = useDeliveryOp(projectId, 'deleteStory');
  const clearFlag = useDeliveryOp(projectId, 'clearReviewFlag');
  const refine = useDeliveryAi('refineStory');
  const generateTech = useDeliveryAi('generateTechnicalStories');

  const live = story ? (snapshot.stories.find((s) => s.id === story.id) ?? story) : null;
  const editable = canEditStory(role, { storyType: type }) && (!live || live.status === 'draft');
  const dirty = !live || JSON.stringify(contentOf(live)) !== JSON.stringify(content) || designStatus !== live.designStatus;
  const openSprint = live
    ? snapshot.sprintItems.some(
        (i) =>
          i.storyId === live.id &&
          i.removedAt === null &&
          snapshot.sprints.some((s) => s.id === i.sprintId && (s.status === 'planned' || s.status === 'active')),
      )
    : false;
  const set = <K extends keyof StoryContent>(key: K, value: StoryContent[K]) => setContent((c) => ({ ...c, [key]: value }));
  const busy = create.isPending || update.isPending || setStatus.isPending || remove.isPending;
  const error =
    create.error ?? update.error ?? setStatus.error ?? remove.error ?? refine.error ?? generateTech.error ?? clearFlag.error;

  const activities = useMemo(
    () => [...lookups.activities.values()].map((a) => ({ id: `${a.processId}|${a.nodeKey}`, ...a })),
    [lookups.activities],
  );
  const otherStories = snapshot.stories.filter((s) => s.id !== live?.id);
  const functional = otherStories.filter((s) => s.storyType === 'functional');
  const implementedBy = live ? snapshot.stories.filter((s) => s.implementsIds.includes(live.id)) : [];
  const scenarios = live ? snapshot.scenarios.filter((sc) => sc.storyIds.includes(live.id)) : [];

  const save = () => {
    if (!live) {
      create.mutate({ projectId, storyType: type, content, origin: 'manual' }, { onSuccess: () => onClose() });
    } else {
      update.mutate(
        { storyId: live.id, revision: live.revision, content, designStatus: type === 'technical' ? designStatus : undefined },
        { onSuccess: () => setNotice('Saved.') },
      );
    }
  };

  const actions = live
    ? ACTIONS.filter((a) => a.from.includes(live.status)).map((a) => ({
        ...a,
        problem: checkStoryStatusChange(live, a.to, role, openSprint),
      }))
    : [];
  const readiness = live && live.status === 'draft' ? storyReadinessProblems(live) : [];
  const title = live ? `${live.refCode} ${live.title}` : `New ${STORY_TYPE_LABELS[type].toLowerCase()} story`;

  return (
    <Dialog
      open
      size="xl"
      onClose={busy ? () => undefined : onClose}
      title={title}
      description={
        live ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{STORY_TYPE_LABELS[type]}</Badge>
            <StoryStatusBadge status={live.status} />
            {live.status === 'in_backlog' ? <WorkStatusBadge status={live.workStatus} /> : null}
            {live.origin !== 'manual' ? (
              <AiGeneratedBadge label={live.origin === 'inferred' ? 'AI inferred' : 'AI from process'} />
            ) : null}
            {type === 'technical' && live.designStatus === 'proposed' ? <Badge tone="amber">Proposed design</Badge> : null}
            <span className="text-xs text-slate-400">Version {live.version}</span>
          </span>
        ) : (
          'Write the story, link it to the activities and data it covers, then submit it for review.'
        )
      }
      footer={
        <>
          {live?.status === 'draft' && editable ? (
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" />}
              className="mr-auto"
              loading={remove.isPending}
              onClick={() => remove.mutate({ storyId: live.id }, { onSuccess: onClose })}
            >
              Delete
            </Button>
          ) : null}
          <Button onClick={onClose} disabled={busy}>
            Close
          </Button>
          {editable ? (
            <Button
              variant="primary"
              onClick={save}
              loading={create.isPending || update.isPending}
              disabled={!dirty || !content.title.trim()}
            >
              {live ? 'Save changes' : 'Create story'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {live?.reviewFlag ? (
            <Alert
              tone="warning"
              title="Review needed after a process change"
              action={
                <Button
                  size="sm"
                  icon={<Flag className="size-3.5" />}
                  loading={clearFlag.isPending}
                  onClick={() => clearFlag.mutate({ entityType: 'story', id: live.id })}
                >
                  Mark reviewed
                </Button>
              }
            >
              {live.reviewFlag}
            </Alert>
          ) : null}
          {notice && !dirty ? <Alert tone="success">{notice}</Alert> : null}
          {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
          {live && !editable && live.status !== 'draft' ? (
            <Alert tone="info">
              This story is {live.status.replace('_', ' ')}. Reopen it for changes to edit it; reopening starts version{' '}
              {live.version + 1}.
            </Alert>
          ) : null}

          <Field label="Title">
            {(id) => (
              <Input
                id={id}
                value={content.title}
                disabled={!editable}
                maxLength={300}
                onChange={(e) => set('title', e.target.value)}
              />
            )}
          </Field>

          {type === 'functional' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="As a">
                {(id) => (
                  <Input
                    id={id}
                    value={content.userRole}
                    disabled={!editable}
                    onChange={(e) => set('userRole', e.target.value)}
                  />
                )}
              </Field>
              <Field label="I want">
                {(id) => (
                  <Input
                    id={id}
                    value={content.objective}
                    disabled={!editable}
                    onChange={(e) => set('objective', e.target.value)}
                  />
                )}
              </Field>
              <Field label="So that">
                {(id) => (
                  <Input id={id} value={content.benefit} disabled={!editable} onChange={(e) => set('benefit', e.target.value)} />
                )}
              </Field>
            </div>
          ) : (
            <Field label="Objective">
              {(id) => (
                <Textarea
                  id={id}
                  rows={2}
                  value={content.objective}
                  disabled={!editable}
                  onChange={(e) => set('objective', e.target.value)}
                />
              )}
            </Field>
          )}
          <Field label="Description">
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                value={content.description}
                disabled={!editable}
                onChange={(e) => set('description', e.target.value)}
              />
            )}
          </Field>

          {type === 'functional' ? (
            <>
              <ItemListEditor
                label="Main flow"
                items={content.behaviour}
                disabled={!editable}
                onChange={(v) => set('behaviour', v)}
                placeholder="The officer enters…"
              />
              <ItemListEditor
                label="Alternative flows"
                items={content.alternativeFlows}
                disabled={!editable}
                onChange={(v) => set('alternativeFlows', v)}
              />
            </>
          ) : (
            <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-700">Technical design</p>
                {designStatus === 'proposed' ? (
                  <span className="flex items-center gap-2">
                    <Badge tone="amber">Proposed: not yet confirmed by a developer</Badge>
                    {editable && (role === 'developer' || role === 'admin') ? (
                      <Button size="sm" icon={<CheckCircle2 className="size-3.5" />} onClick={() => setDesignStatus('confirmed')}>
                        Confirm design
                      </Button>
                    ) : null}
                  </span>
                ) : (
                  <Badge tone="green">Confirmed design</Badge>
                )}
              </div>
              {(
                [
                  ['apiBehaviour', 'Proposed API behaviour'],
                  ['requiredData', 'Required data'],
                  ['validationLogic', 'Validation logic'],
                  ['expectedResponse', 'Expected response'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  {(id) => (
                    <Textarea
                      id={id}
                      rows={2}
                      value={content[key]}
                      disabled={!editable}
                      onChange={(e) => set(key, e.target.value)}
                    />
                  )}
                </Field>
              ))}
              <ItemListEditor
                label="Error scenarios"
                items={content.errorScenarios}
                disabled={!editable}
                onChange={(v) => set('errorScenarios', v)}
              />
            </div>
          )}
          <ItemListEditor
            label="Acceptance criteria"
            items={content.acceptanceCriteria}
            disabled={!editable}
            onChange={(v) => set('acceptanceCriteria', v)}
            placeholder="Given …, when …, then …"
          />
          <Field label="Notes">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={content.notes}
                disabled={!editable}
                onChange={(e) => set('notes', e.target.value)}
              />
            )}
          </Field>

          {live && refinement ? (
            <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm">
              <p className="font-medium text-violet-900">AI review ({refinement.model})</p>
              <ul className="list-disc space-y-1 pl-5 text-violet-900">
                {refinement.refinement.issues.map((issue, i) => (
                  <li key={i}>
                    <b>{issue.severity}:</b> {issue.problem} <i>{issue.suggestion}</i>
                  </li>
                ))}
              </ul>
              {refinement.refinement.questions.length ? (
                <p className="text-xs">Questions: {refinement.refinement.questions.join(' ')}</p>
              ) : null}
              <div className="flex gap-2">
                {editable ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      const r = refinement.refinement.refined;
                      setContent((c) => ({
                        ...c,
                        title: r.title || c.title,
                        userRole: r.userRole,
                        objective: r.objective,
                        benefit: r.benefit,
                        description: r.description,
                        behaviour: toItems(r.behaviour),
                        alternativeFlows: toItems(r.alternativeFlows),
                        acceptanceCriteria: toItems(r.acceptanceCriteria),
                      }));
                      setRefinement(null);
                    }}
                  >
                    Apply refined wording (review, then save)
                  </Button>
                ) : (
                  <p className="text-xs text-violet-800">Reopen the story to apply these suggestions.</p>
                )}
                <Button size="sm" variant="ghost" onClick={() => setRefinement(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4">
          {live ? (
            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-700">Workflow</p>
              {readiness.length > 0 ? <p className="text-xs text-slate-500">Before review: {readiness.join('; ')}.</p> : null}
              <Input
                aria-label="Review comment"
                placeholder="Comment (optional)"
                className="h-8 text-xs"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <Button
                    key={a.label}
                    size="sm"
                    variant={a.primary ? 'primary' : 'secondary'}
                    disabled={Boolean(a.problem) || dirty}
                    title={dirty ? 'Save your changes first' : (a.problem ?? undefined)}
                    loading={setStatus.isPending && setStatus.variables?.status === a.to}
                    onClick={() =>
                      setStatus.mutate(
                        { storyId: live.id, revision: live.revision, status: a.to, comment },
                        { onSuccess: () => setComment('') },
                      )
                    }
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                {canEditStory(role, live) || canDeliver(role, 'reviewStory') ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Sparkles className="size-3.5" />}
                    loading={refine.isPending}
                    onClick={() => refine.mutate({ input: { storyId: live.id } }, { onSuccess: setRefinement })}
                  >
                    Refine with AI
                  </Button>
                ) : null}
                {type === 'functional' && canDeliver(role, 'editTechnical') ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Sparkles className="size-3.5" />}
                    loading={generateTech.isPending}
                    onClick={() => generateTech.mutate({ input: { storyId: live.id } }, { onSuccess: setTechProposal })}
                  >
                    Generate technical stories
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <LinkPicker
            label="Process activities"
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
            empty="Create and approve a process map first."
          />
          <LinkPicker
            label="Input and output fields"
            options={context.fields}
            selected={content.fieldIds}
            disabled={!editable}
            onChange={(v) => set('fieldIds', v)}
            render={(f) => `${f.refCode} ${f.name}`}
          />
          <LinkPicker
            label="Validation rules"
            options={context.validationRules}
            selected={content.validationRuleIds}
            disabled={!editable}
            onChange={(v) => set('validationRuleIds', v)}
            render={(r) => `${r.refCode} ${r.statement}`}
          />
          <LinkPicker
            label="Business rules"
            options={context.businessRules}
            selected={content.businessRuleIds}
            disabled={!editable}
            onChange={(v) => set('businessRuleIds', v)}
            render={(r) => `${r.refCode} ${r.title}`}
          />
          {type === 'technical' ? (
            <LinkPicker
              label="Implements functional stories"
              options={functional}
              selected={content.implementsIds}
              disabled={!editable}
              onChange={(v) => set('implementsIds', v)}
              render={(s) => `${s.refCode} ${s.title}`}
            />
          ) : null}
          <LinkPicker
            label="Depends on"
            options={otherStories}
            selected={content.dependsOnIds}
            disabled={!editable}
            onChange={(v) => set('dependsOnIds', v)}
            render={(s) => `${s.refCode} ${s.title}`}
          />
          {live && (implementedBy.length > 0 || scenarios.length > 0) ? (
            <div className="space-y-1 text-xs text-slate-600">
              {implementedBy.length ? <p>Implemented by: {implementedBy.map((s) => s.refCode).join(', ')}</p> : null}
              {scenarios.length ? <p>Tested by: {scenarios.map((s) => s.refCode).join(', ')}</p> : null}
            </div>
          ) : null}
        </aside>
      </div>
      {live ? (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <History projectId={projectId} entityType="story" entityId={live.id} events={snapshot.events} lookups={lookups} />
        </div>
      ) : null}
      {techProposal ? (
        <StoryProposalDialog
          projectId={projectId}
          proposal={techProposal}
          lookups={lookups}
          onClose={() => setTechProposal(null)}
          onCreated={(n) => {
            setTechProposal(null);
            setNotice(`${n} technical stor${n === 1 ? 'y' : 'ies'} added as drafts.`);
          }}
        />
      ) : null}
    </Dialog>
  );
}
