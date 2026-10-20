import { canDeliver, consistencyChecks, type ChangeImpactResult, type ConsistencyIssue, type Insight } from '@productflow/domain';
import { AlertTriangle, Check, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { Alert, Badge, Button, Field, Select } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useDelivery, useDeliveryAi, useDeliveryOp } from './api';
import { DeliveryPage, Loading, Section } from './shared';

const SEVERITY_TONE: Record<ConsistencyIssue['severity'], 'red' | 'amber' | 'slate'> = {
  error: 'red',
  warning: 'amber',
  info: 'slate',
};
const IMPACT_TONE = { high: 'red', medium: 'amber', low: 'slate' } as const;

/** Requirement insights: automated consistency checks, AI change-impact analysis and process improvement recommendations. */
export function InsightsPage() {
  const { projectId = '' } = useParams();
  const { role, snapshot, context, isPending, error } = useDelivery(projectId);
  const [category, setCategory] = useState<ConsistencyIssue['category'] | 'all'>('all');
  const allowed = canDeliver(role, 'runInsights');

  if (!snapshot || !context) {
    return (
      <DeliveryPage projectId={projectId} module="Delivery Dashboard" title="Requirement insights" description="">
        <Loading isPending={isPending} error={error} />
      </DeliveryPage>
    );
  }
  const issues = consistencyChecks(context, snapshot);
  const shown = issues.filter((i) => category === 'all' || i.category === category);

  return (
    <DeliveryPage
      projectId={projectId}
      module="Delivery Dashboard"
      title="Requirement insights"
      description="Checks across processes, data, stories and tests, and AI recommendations for the team to review. Nothing here changes approved content."
    >
      <div className="space-y-6">
        <Section
          title={`Consistency checks (${issues.length})`}
          actions={
            <Select
              aria-label="Check category"
              className="h-8 w-40 text-xs"
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
            >
              <option value="all">All categories</option>
              <option value="coverage">Coverage</option>
              <option value="links">Links</option>
              <option value="quality">Quality</option>
              <option value="planning">Planning</option>
            </Select>
          }
        >
          {shown.length === 0 ? <p className="text-sm text-slate-500">No issues found.</p> : null}
          <ul className="divide-y divide-slate-100 text-sm">
            {shown.map((i) => (
              <li key={i.id} className="flex items-start gap-2 py-1.5">
                <Badge tone={SEVERITY_TONE[i.severity]}>{i.severity}</Badge>
                <span className="text-slate-700">{i.message}</span>
              </li>
            ))}
          </ul>
        </Section>
        {allowed ? <ChangeImpact projectId={projectId} processes={context.processes} /> : null}
        <Improvements projectId={projectId} processes={context.processes} insights={snapshot.insights} allowed={allowed} />
      </div>
    </DeliveryPage>
  );
}

function ChangeImpact({
  projectId,
  processes,
}: {
  projectId: string;
  processes: { id: string; ref_code: string; name: string }[];
}) {
  const [processId, setProcessId] = useState(processes[0]?.id ?? '');
  const [result, setResult] = useState<ChangeImpactResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const analyse = useDeliveryAi('analyseChangeImpact');
  const apply = useDeliveryOp(projectId, 'applyChangeImpact');
  const [applied, setApplied] = useState(false);
  const assessment = (ref: string) => result?.assessment?.assessments.find((a) => a.ref === ref);

  return (
    <Section title="Change impact analysis">
      <p className="mb-3 text-sm text-slate-600">
        Compare a process's open draft (or latest version) with the version before it. Affected stories and scenarios are found by
        tracing links; Claude assesses each one. Applying flags the selected items for review; their approved content is not
        changed.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Process">
          {(id) => (
            <Select id={id} className="w-72" value={processId} onChange={(e) => setProcessId(e.target.value)}>
              {processes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.ref_code} {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button
          icon={<Sparkles className="size-4" />}
          loading={analyse.isPending}
          disabled={!processId}
          onClick={() =>
            analyse.mutate(
              { input: { processId } },
              {
                onSuccess: (r) => {
                  setResult(r);
                  setApplied(false);
                  setSelected(new Set(r.impact.items.map((i) => i.id)));
                },
              },
            )
          }
        >
          Analyse impact
        </Button>
      </div>
      {analyse.error ? (
        <Alert tone="error" className="mt-3">
          {errorMessage(analyse.error)}
        </Alert>
      ) : null}
      {result ? (
        <div className="mt-4 space-y-3 text-sm">
          {!result.fromVersion || !result.toVersion ? (
            <Alert tone="info">This process has only one version, so there is nothing to compare yet.</Alert>
          ) : (
            <>
              <p className="text-slate-700">
                Version {result.fromVersion.versionNumber} → version {result.toVersion.versionNumber}:{' '}
                {result.impact.changes.length} change
                {result.impact.changes.length === 1 ? '' : 's'}.
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
                {result.impact.changes.map((c, i) => (
                  <li key={i}>{c.description}</li>
                ))}
              </ul>
              {result.assessment ? (
                <p className="text-slate-600">
                  <Sparkles className="mr-1 inline size-3.5 text-violet-600" />
                  {result.assessment.summary} <span className="text-xs text-slate-400">({result.model})</span>
                </p>
              ) : null}
              {result.impact.items.length === 0 ? (
                <Alert tone="success">No stories or scenarios are linked to what changed.</Alert>
              ) : (
                <ul className="space-y-2">
                  {result.impact.items.map((item) => {
                    const a = assessment(item.refCode);
                    return (
                      <li key={item.id} className="rounded-md border border-slate-200 p-2">
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1"
                            aria-label={`Flag ${item.refCode}`}
                            checked={selected.has(item.id)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              setSelected(next);
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="font-mono text-xs text-slate-500">{item.refCode}</span>{' '}
                            <span className="font-medium">{item.title}</span>{' '}
                            {a ? <Badge tone={IMPACT_TONE[a.impact]}>{a.impact} impact</Badge> : null}
                            <span className="block text-xs text-slate-600">{item.reasons.join('; ')}</span>
                            {a ? <span className="block text-xs text-violet-800">{a.recommendation}</span> : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              {result.impact.items.length > 0 ? (
                applied ? (
                  <Alert tone="success">
                    The selected items are flagged for review. Their owners see the flag on each story and scenario.
                  </Alert>
                ) : (
                  <Button
                    variant="primary"
                    icon={<AlertTriangle className="size-4" />}
                    disabled={selected.size === 0}
                    loading={apply.isPending}
                    onClick={() =>
                      apply.mutate(
                        {
                          projectId,
                          processId,
                          summary: result.assessment?.summary ?? '',
                          items: result.impact.items
                            .filter((i) => selected.has(i.id))
                            .map((i) => ({
                              id: i.id,
                              type: i.type,
                              refCode: i.refCode,
                              reason: assessment(i.refCode)?.recommendation ?? i.reasons.join('; '),
                              impact: assessment(i.refCode)?.impact ?? 'medium',
                            })),
                        },
                        { onSuccess: () => setApplied(true) },
                      )
                    }
                  >
                    Flag {selected.size} for review
                  </Button>
                )
              ) : null}
              {apply.error ? <Alert tone="error">{errorMessage(apply.error)}</Alert> : null}
            </>
          )}
        </div>
      ) : null}
    </Section>
  );
}

function Improvements({
  projectId,
  processes,
  insights,
  allowed,
}: {
  projectId: string;
  processes: { id: string; ref_code: string; name: string }[];
  insights: Insight[];
  allowed: boolean;
}) {
  const [processId, setProcessId] = useState(processes[0]?.id ?? '');
  const suggest = useDeliveryOp(projectId, 'suggestImprovements');
  const decide = useDeliveryOp(projectId, 'decideInsight');
  const list = insights.filter((i) => i.kind === 'improvement').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const history = insights.filter((i) => i.kind === 'change_impact');
  return (
    <Section title="Process improvement recommendations">
      {allowed ? (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Field label="Process">
            {(id) => (
              <Select id={id} className="w-72" value={processId} onChange={(e) => setProcessId(e.target.value)}>
                {processes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ref_code} {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            icon={<Sparkles className="size-4" />}
            loading={suggest.isPending}
            disabled={!processId}
            onClick={() => suggest.mutate({ processId })}
          >
            Recommend improvements
          </Button>
        </div>
      ) : null}
      {(suggest.error ?? decide.error) ? <Alert tone="error">{errorMessage(suggest.error ?? decide.error)}</Alert> : null}
      {list.length === 0 ? <p className="text-sm text-slate-500">No recommendations yet.</p> : null}
      <ul className="space-y-2">
        {list.map((i) => (
          <li key={i.id} className="rounded-md border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900">{i.title}</span>
              <Badge tone={IMPACT_TONE[i.impact]}>{i.impact} impact</Badge>
              <Badge tone={i.status === 'accepted' ? 'green' : i.status === 'dismissed' ? 'slate' : 'violet'}>{i.status}</Badge>
              <span className="text-xs text-slate-400">{i.subjects.join(', ')}</span>
            </div>
            <p className="mt-1 text-slate-700">{i.detail}</p>
            {allowed && i.status === 'open' ? (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  icon={<Check className="size-3.5" />}
                  onClick={() => decide.mutate({ insightId: i.id, status: 'accepted' })}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<X className="size-3.5" />}
                  onClick={() => decide.mutate({ insightId: i.id, status: 'dismissed' })}
                >
                  Dismiss
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {history.length ? (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-600">Applied change-impact reviews</p>
          <ul className="mt-1 space-y-1 text-xs text-slate-600">
            {history.map((h) => (
              <li key={h.id}>
                {new Date(h.createdAt).toLocaleDateString()} · {h.title}: {h.subjects.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}
