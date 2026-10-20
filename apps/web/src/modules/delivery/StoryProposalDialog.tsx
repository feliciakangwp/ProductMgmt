import { STORY_TYPE_LABELS, type StoryProposal } from '@productflow/domain';
import { useState } from 'react';
import { Alert, Badge, Button, Dialog } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useDeliveryOp, type Lookups } from './api';
import { AiGeneratedBadge } from './shared';

/**
 * Review of AI-proposed stories. Nothing is saved until the analyst picks
 * what to keep; accepted stories start as drafts, and technical designs stay
 * "Proposed" until a developer confirms them.
 */
export function StoryProposalDialog({
  projectId,
  proposal,
  lookups,
  onClose,
  onCreated,
}: {
  projectId: string;
  proposal: StoryProposal;
  lookups: Lookups;
  onClose: () => void;
  onCreated: (count: number) => void;
}) {
  const [selected, setSelected] = useState(() => new Set(proposal.stories.map((_, i) => i)));
  const create = useDeliveryOp(projectId, 'createStories');
  const technical = proposal.stories[0]?.storyType === 'technical';
  const title = technical ? 'Review proposed technical stories' : 'Review suggested user stories';

  return (
    <Dialog
      open
      size="xl"
      onClose={create.isPending ? () => undefined : onClose}
      title={title}
      description={
        <>
          From {proposal.model}. Tick the stories to keep: they are added as drafts for review.
          {technical ? ' Designs are labelled Proposed until a developer confirms them.' : ''}
        </>
      }
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            Discard
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={selected.size === 0}
            onClick={() =>
              create.mutate(
                {
                  projectId,
                  stories: proposal.stories
                    .filter((_, i) => selected.has(i))
                    .map((s) => ({ storyType: s.storyType, content: s.content, origin: s.origin })),
                },
                { onSuccess: (created) => onCreated(created.length) },
              )
            }
          >
            Add {selected.size} as drafts
          </Button>
        </>
      }
    >
      {proposal.questions.length > 0 ? (
        <Alert tone="warning" title="Questions for you" className="mb-4">
          <ul className="list-disc pl-4">
            {proposal.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {proposal.stories.length === 0 ? <p className="text-sm text-slate-500">No new stories were suggested.</p> : null}
      <ul className="space-y-3">
        {proposal.stories.map((s, i) => (
          <li key={i} className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                aria-label={`Keep ${s.content.title}`}
                checked={selected.has(i)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(i);
                  else next.delete(i);
                  setSelected(next);
                }}
              />
              <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{s.content.title}</span>
                  <Badge>{STORY_TYPE_LABELS[s.storyType]}</Badge>
                  {s.origin === 'inferred' ? <AiGeneratedBadge label="Inferred" /> : <Badge tone="blue">Stated in process</Badge>}
                  {technical ? <Badge tone="amber">Proposed design</Badge> : null}
                </div>
                {s.storyType === 'functional' ? (
                  <p className="text-slate-700">
                    As a <b>{s.content.userRole}</b>, I want {s.content.objective}, so that {s.content.benefit}.
                  </p>
                ) : (
                  <>
                    <p className="text-slate-700">{s.content.objective}</p>
                    <p className="text-xs text-slate-600">
                      <b>API:</b> {s.content.apiBehaviour}
                    </p>
                    <p className="text-xs text-slate-600">
                      <b>Validation:</b> {s.content.validationLogic}
                    </p>
                  </>
                )}
                <details>
                  <summary className="cursor-pointer text-xs text-brand-700">
                    {s.content.acceptanceCriteria.length} acceptance criteria
                    {s.content.behaviour.length ? `, ${s.content.behaviour.length} steps` : ''}
                    {s.content.errorScenarios.length ? `, ${s.content.errorScenarios.length} error scenarios` : ''}
                  </summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-700">
                    {[...s.content.behaviour, ...s.content.acceptanceCriteria, ...s.content.errorScenarios].map((c) => (
                      <li key={c.id}>{c.text}</li>
                    ))}
                  </ul>
                </details>
                <p className="text-xs text-slate-500">
                  {s.content.activities.map((a) => lookups.activityName(a)).join(', ')}
                  {s.content.fieldIds.length
                    ? ` · Fields: ${s.content.fieldIds.map((id) => lookups.field(id)?.name ?? '').join(', ')}`
                    : ''}
                </p>
                {s.assumptions.length > 0 ? (
                  <p className="text-xs text-amber-800">Assumptions to confirm: {s.assumptions.join(' ')}</p>
                ) : null}
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
