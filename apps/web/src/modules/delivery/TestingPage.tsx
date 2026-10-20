import {
  canDeliver,
  executionOutcome,
  newestExecutionFirst,
  scenarioReadiness,
  scenarioUatStatus,
  STEP_RESULT_LABELS,
  STEP_RESULTS,
  type StepExecution,
  type StepResult,
  type TestExecution,
} from '@productflow/domain';
import { Bug, ClipboardCheck, Play } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert, Badge, Button, EmptyState, Field, Input, Select, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useDelivery, useDeliveryOp } from './api';
import { DefectDialog, type DefectSource } from './DefectDialog';
import { DefectStatusBadge, DeliveryPage, Loading, Section, UatBadge } from './shared';

const RESULT_TONE: Record<StepResult, 'slate' | 'green' | 'red' | 'amber'> = {
  not_tested: 'slate',
  pass: 'green',
  fail: 'red',
  blocked: 'amber',
};
const EXECUTION_TONE = { in_progress: 'violet', passed: 'green', failed: 'red', blocked: 'amber' } as const;

/** Business Testing: run UAT on scenarios that are ready, and keep every execution as history. */
export function TestingPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const { role, snapshot, lookups, isPending, error } = useDelivery(projectId);
  const start = useDeliveryOp(projectId, 'startExecution');
  const canTest = canDeliver(role, 'executeTests');

  return (
    <DeliveryPage
      projectId={projectId}
      module="Business Testing"
      title="User acceptance testing"
      description="Execute business scenarios step by step. Completed tests are kept unchanged as history."
    >
      <Loading isPending={isPending} error={error} />
      {start.error ? (
        <Alert tone="error" className="mb-4">
          {errorMessage(start.error)}
        </Alert>
      ) : null}
      {snapshot && lookups ? (
        snapshot.scenarios.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="size-8" />} title="No scenarios to test">
            Write business scenarios first; they appear here when ready for UAT.
          </EmptyState>
        ) : (
          <div className="space-y-6">
            <Section title="Scenarios">
              <ul className="divide-y divide-slate-100">
                {snapshot.scenarios.map((sc) => {
                  const readiness = scenarioReadiness(sc, new Map(snapshot.stories.map((s) => [s.id, s])));
                  const uat = scenarioUatStatus(sc, snapshot.executions, readiness);
                  const running = snapshot.executions.find((e) => e.scenarioId === sc.id && e.status === 'in_progress');
                  return (
                    <li key={sc.id} className={cn('flex flex-wrap items-center gap-3 py-2', uat === 'not_ready' && 'opacity-60')}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-mono text-xs text-slate-500">{sc.refCode}</span>{' '}
                          <span className="font-medium">{sc.title}</span> <UatBadge status={uat} />
                        </p>
                        {!readiness.ready ? <p className="text-xs text-slate-500">{readiness.reasons.join('. ')}.</p> : null}
                      </div>
                      {running ? (
                        <Button size="sm" onClick={() => navigate(`/projects/${projectId}/testing/${running.id}`)}>
                          Continue {running.refCode}
                        </Button>
                      ) : canTest && readiness.ready ? (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<Play className="size-3.5" />}
                          loading={start.isPending && start.variables?.scenarioId === sc.id}
                          onClick={() =>
                            start.mutate(
                              { scenarioId: sc.id },
                              { onSuccess: (e) => navigate(`/projects/${projectId}/testing/${e.id}`) },
                            )
                          }
                        >
                          {uat === 'ready' ? 'Start test' : 'Retest'}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Section>
            <Section title="Test history">
              {snapshot.executions.length === 0 ? <p className="text-sm text-slate-500">No tests run yet.</p> : null}
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {[...snapshot.executions].sort(newestExecutionFirst).map((e) => {
                    const sc = snapshot.scenarios.find((s) => s.id === e.scenarioId);
                    const defects = snapshot.defects.filter((d) => d.executionId === e.id).length;
                    return (
                      <tr key={e.id}>
                        <td className="py-1.5 pr-2">
                          <Link
                            className="font-mono text-xs text-brand-700 hover:underline"
                            to={`/projects/${projectId}/testing/${e.id}`}
                          >
                            {e.refCode}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-2">
                          {sc?.refCode} {sc?.title} <span className="text-xs text-slate-400">v{e.scenarioVersion}</span>
                        </td>
                        <td className="py-1.5 pr-2">
                          <Badge tone={EXECUTION_TONE[e.status]}>{e.status.replace('_', ' ')}</Badge>
                        </td>
                        <td className="py-1.5 pr-2 text-xs text-slate-500">{lookups.memberName(e.testerId)}</td>
                        <td className="py-1.5 pr-2 text-xs text-slate-500">{new Date(e.startedAt).toLocaleString()}</td>
                        <td className="py-1.5 text-xs text-slate-500">
                          {defects ? `${defects} defect${defects > 1 ? 's' : ''}` : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>
          </div>
        )
      ) : null}
    </DeliveryPage>
  );
}

function StepForm({
  index,
  result,
  expected,
  editable,
  saving,
  onSave,
}: {
  index: number;
  result: StepExecution;
  expected: { action: string; inputData: string; expectedBehaviour: string; expectedResult: string };
  editable: boolean;
  saving: boolean;
  onSave: (r: StepExecution) => void;
}) {
  const [value, setValue] = useState(result);
  const dirty = JSON.stringify(value) !== JSON.stringify(result);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">
          Step {index + 1}: {expected.action}
        </p>
        <Badge tone={RESULT_TONE[result.status]}>{STEP_RESULT_LABELS[result.status]}</Badge>
      </div>
      <dl className="mt-1 grid gap-x-4 text-xs text-slate-600 sm:grid-cols-2">
        <div>
          <dt className="inline font-medium">Expected behaviour: </dt>
          <dd className="inline">{expected.expectedBehaviour || '–'}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Expected result: </dt>
          <dd className="inline">{expected.expectedResult}</dd>
        </div>
      </dl>
      {editable ? (
        <form
          className="mt-2 grid gap-2 sm:grid-cols-[140px_1fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(value);
          }}
        >
          <Field label="Result">
            {(id) => (
              <Select id={id} value={value.status} onChange={(e) => setValue({ ...value, status: e.target.value as StepResult })}>
                {STEP_RESULTS.map((r) => (
                  <option key={r} value={r}>
                    {STEP_RESULT_LABELS[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Test data">
            {(id) => <Input id={id} value={value.testData} onChange={(e) => setValue({ ...value, testData: e.target.value })} />}
          </Field>
          <Field label="Actual result">
            {(id) => (
              <Input id={id} value={value.actualResult} onChange={(e) => setValue({ ...value, actualResult: e.target.value })} />
            )}
          </Field>
          <Field label="Remarks">
            {(id) => <Input id={id} value={value.remarks} onChange={(e) => setValue({ ...value, remarks: e.target.value })} />}
          </Field>
          <Button type="submit" size="sm" disabled={!dirty} loading={saving}>
            Save step {index + 1}
          </Button>
        </form>
      ) : (
        <p className="mt-1 text-xs text-slate-700">
          Test data: {result.testData || '–'} · Actual: {result.actualResult || '–'}{' '}
          {result.remarks ? `· Remarks: ${result.remarks}` : ''}
        </p>
      )}
    </div>
  );
}

/** One test execution: record each step's result, raise defects from failed steps, then complete it. */
export function ExecutionPage() {
  const { projectId = '', executionId = '' } = useParams();
  const { role, snapshot, lookups, isPending, error } = useDelivery(projectId);
  const record = useDeliveryOp(projectId, 'recordStepResult');
  const complete = useDeliveryOp(projectId, 'completeExecution');
  const [remarks, setRemarks] = useState('');
  const [defectFor, setDefectFor] = useState<DefectSource | null>(null);
  const execution: TestExecution | undefined = snapshot?.executions.find((e) => e.id === executionId);
  const scenario = execution && snapshot?.scenarios.find((s) => s.id === execution.scenarioId);
  const editable = execution?.status === 'in_progress' && canDeliver(role, 'executeTests');
  const outcome = execution ? executionOutcome(execution.results) : null;

  return (
    <DeliveryPage
      projectId={projectId}
      module="Business Testing"
      title={execution && scenario ? `${execution.refCode} · ${scenario.refCode} ${scenario.title}` : 'Test execution'}
      description={
        execution
          ? `Scenario version ${execution.scenarioVersion}, tested by ${lookups?.memberName(execution.testerId) ?? ''} from ${new Date(execution.startedAt).toLocaleString()}.`
          : ''
      }
      actions={
        <Link className="text-sm text-brand-700 hover:underline" to={`/projects/${projectId}/testing`}>
          Back to testing
        </Link>
      }
    >
      <Loading isPending={isPending} error={error} />
      {snapshot && !execution && !isPending ? <Alert tone="error">Test execution not found.</Alert> : null}
      {execution && scenario && snapshot && lookups ? (
        <div className="space-y-4">
          {execution.status !== 'in_progress' ? (
            <Alert tone={execution.status === 'passed' ? 'success' : 'warning'} title={`Completed: ${execution.status}`}>
              This test is part of the scenario's history and cannot be changed. {execution.remarks}
            </Alert>
          ) : null}
          {(record.error ?? complete.error) ? <Alert tone="error">{errorMessage(record.error ?? complete.error)}</Alert> : null}
          {scenario.preconditions.length ? (
            <Section title="Preconditions">
              <ul className="list-disc pl-5 text-sm">
                {scenario.preconditions.map((p) => (
                  <li key={p.id}>{p.text}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          <ol className="space-y-2">
            {execution.steps.map((step, i) => {
              const result = execution.results.find((r) => r.stepId === step.id)!;
              const defects = snapshot.defects.filter((d) => d.executionId === execution.id && d.stepId === step.id);
              return (
                <li key={step.id}>
                  <StepForm
                    key={`${step.id}:${execution.revision}`}
                    index={i}
                    result={result}
                    expected={step}
                    editable={editable}
                    saving={record.isPending && record.variables?.stepId === step.id}
                    onSave={(r) => record.mutate({ executionId: execution.id, revision: execution.revision, ...r })}
                  />
                  {result.status === 'fail' ? (
                    <div className="mt-1 ml-3 flex flex-wrap items-center gap-2 text-xs">
                      {defects.map((d) => (
                        <span key={d.id} className="flex items-center gap-1">
                          <Link
                            className="font-mono text-brand-700 hover:underline"
                            to={`/projects/${projectId}/defects?open=${d.id}`}
                          >
                            {d.refCode}
                          </Link>
                          <DefectStatusBadge status={d.status} />
                        </span>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Bug className="size-3.5" />}
                        onClick={() =>
                          setDefectFor({
                            executionId: execution.id,
                            stepId: step.id,
                            stepNumber: i + 1,
                            scenarioRef: scenario.refCode,
                            storyIds: scenario.storyIds,
                            expectedResult: step.expectedResult,
                            actualResult: result.actualResult,
                            remarks: result.remarks,
                          })
                        }
                      >
                        Raise defect for step {i + 1}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {editable ? (
            <Section title="Complete the test">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Overall remarks" className="min-w-60 flex-1">
                  {(id) => <Textarea id={id} rows={1} value={remarks} onChange={(e) => setRemarks(e.target.value)} />}
                </Field>
                <Button
                  variant="primary"
                  loading={complete.isPending}
                  disabled={!outcome || 'error' in outcome}
                  title={outcome && 'error' in outcome ? outcome.error : undefined}
                  onClick={() => complete.mutate({ executionId: execution.id, revision: execution.revision, remarks })}
                >
                  Complete test{outcome && 'status' in outcome ? `: ${outcome.status}` : ''}
                </Button>
              </div>
              {outcome && 'error' in outcome ? <p className="mt-1 text-xs text-slate-500">{outcome.error}.</p> : null}
            </Section>
          ) : null}
        </div>
      ) : null}
      {defectFor && snapshot && lookups ? (
        <DefectDialog
          projectId={projectId}
          defect={null}
          source={defectFor}
          role={role}
          snapshot={snapshot}
          lookups={lookups}
          onClose={() => setDefectFor(null)}
        />
      ) : null}
    </DeliveryPage>
  );
}
