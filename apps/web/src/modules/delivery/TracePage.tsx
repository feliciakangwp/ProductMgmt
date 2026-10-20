import { traceActivity, type ActivityInfo } from '@productflow/domain';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Badge, Field, Select } from '../../components/ui';
import { useDelivery } from './api';
import { DefectStatusBadge, DeliveryPage, Loading, Section, StoryStatusBadge, UatBadge, WorkStatusBadge } from './shared';

/** End-to-end traceability: from one process activity to its data, rules, stories, development status, tests and defects. */
export function TracePage() {
  const { projectId = '' } = useParams();
  const { snapshot, context, lookups, isPending, error } = useDelivery(projectId);
  const [key, setKey] = useState('');

  if (!snapshot || !context || !lookups) {
    return (
      <DeliveryPage projectId={projectId} module="Traceability" title="Traceability" description="">
        <Loading isPending={isPending} error={error} />
      </DeliveryPage>
    );
  }
  const activities = [...lookups.activities.entries()];
  const selectedKey = key || activities[0]?.[0] || '';
  const info: ActivityInfo | undefined = lookups.activities.get(selectedKey);
  const trace = info ? traceActivity(context, snapshot, { processId: info.processId, nodeKey: info.nodeKey }) : null;

  return (
    <DeliveryPage
      projectId={projectId}
      module="Traceability"
      title="Traceability"
      description="Process → activity → fields → validation rules → stories → sprint → test scenarios → executions → defects."
    >
      <Field label="Activity" className="mb-6 max-w-xl">
        {(id) => (
          <Select id={id} value={selectedKey} onChange={(e) => setKey(e.target.value)}>
            {activities.map(([k, a]) => (
              <option key={k} value={k}>
                {a.processRef} {a.processName} · {a.refCode ?? ''} {a.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {trace ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Data">
            <p className="text-xs text-slate-500">
              From {trace.activity.processRef} v{trace.activity.versionNumber} ({trace.activity.versionStatus})
            </p>
            <p className="mt-2 text-xs font-medium text-slate-600">Inputs</p>
            <ul className="text-sm">
              {trace.inputs.map((i) => (
                <li key={i.field.id}>
                  {i.field.refCode} {i.field.name}{' '}
                  <span className="text-xs text-slate-500">
                    {i.mandatory === 'conditional'
                      ? `required when ${i.condition}`
                      : i.mandatory === 'yes'
                        ? 'mandatory'
                        : 'optional'}
                  </span>
                </li>
              ))}
              {trace.inputs.length === 0 ? <li className="text-slate-400">None</li> : null}
            </ul>
            <p className="mt-2 text-xs font-medium text-slate-600">Outputs</p>
            <ul className="text-sm">
              {trace.outputs.map((f) => (
                <li key={f.id}>
                  {f.refCode} {f.name}
                </li>
              ))}
              {trace.outputs.length === 0 ? <li className="text-slate-400">None</li> : null}
            </ul>
          </Section>
          <Section title="Rules">
            <p className="text-xs font-medium text-slate-600">Validation rules</p>
            <ul className="text-sm">
              {trace.validationRules.map((r) => (
                <li key={r.id}>
                  {r.refCode} {r.statement} <Badge tone={r.status === 'confirmed' ? 'green' : 'amber'}>{r.status}</Badge>
                </li>
              ))}
              {trace.validationRules.length === 0 ? <li className="text-slate-400">None</li> : null}
            </ul>
            <p className="mt-2 text-xs font-medium text-slate-600">Business rules</p>
            <ul className="text-sm">
              {trace.businessRules.map((r) => (
                <li key={r.id}>
                  {r.refCode} {r.title}
                </li>
              ))}
              {trace.businessRules.length === 0 ? <li className="text-slate-400">None</li> : null}
            </ul>
          </Section>
          <Section title="Stories and development status">
            <ul className="space-y-1 text-sm">
              {[...trace.functionalStories, ...trace.technicalStories].map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs text-slate-500">{s.refCode}</span> {s.title}
                  <StoryStatusBadge status={s.status} />
                  {s.status === 'in_backlog' ? <WorkStatusBadge status={s.workStatus} /> : null}
                  <span className="text-xs text-slate-500">
                    {snapshot.sprintItems
                      .filter((i) => i.storyId === s.id && i.removedAt === null)
                      .map((i) => snapshot.sprints.find((sp) => sp.id === i.sprintId)?.name)
                      .join(', ')}
                  </span>
                </li>
              ))}
              {trace.functionalStories.length + trace.technicalStories.length === 0 ? (
                <li className="text-slate-400">No stories cover this activity yet.</li>
              ) : null}
            </ul>
          </Section>
          <Section title="Testing and defects">
            <ul className="space-y-1 text-sm">
              {trace.scenarios.map(({ scenario, uat, lastExecution }) => (
                <li key={scenario.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs text-slate-500">{scenario.refCode}</span> {scenario.title}{' '}
                  <UatBadge status={uat} />
                  {lastExecution ? (
                    <Link
                      className="text-xs text-brand-700 hover:underline"
                      to={`/projects/${projectId}/testing/${lastExecution.id}`}
                    >
                      {lastExecution.refCode}
                    </Link>
                  ) : null}
                </li>
              ))}
              {trace.scenarios.length === 0 ? <li className="text-slate-400">No test scenarios yet.</li> : null}
            </ul>
            <p className="mt-2 text-xs font-medium text-slate-600">Open defects</p>
            <ul className="space-y-1 text-sm">
              {trace.openDefects.map((d) => (
                <li key={d.id} className="flex items-center gap-1.5">
                  <Link
                    className="font-mono text-xs text-brand-700 hover:underline"
                    to={`/projects/${projectId}/defects?open=${d.id}`}
                  >
                    {d.refCode}
                  </Link>{' '}
                  {d.title} <DefectStatusBadge status={d.status} />
                </li>
              ))}
              {trace.openDefects.length === 0 ? <li className="text-slate-400">None</li> : null}
            </ul>
          </Section>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Create a process map to trace its activities.</p>
      )}
    </DeliveryPage>
  );
}
