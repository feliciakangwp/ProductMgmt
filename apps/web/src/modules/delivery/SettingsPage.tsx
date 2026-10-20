import { canDeliver, type DeliverySettings } from '@productflow/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { Alert, Button, Field, Input, Textarea } from '../../components/ui';
import { backend } from '../../lib/backend';
import { errorMessage } from '../../lib/errors';
import { useUpdateProject } from '../projects/api';
import { useDelivery, useDeliveryOp } from './api';
import { DeliveryPage, Loading, Section } from './shared';

/** Settings: project details, delivery workflow rules, and (in the demo) how AI is reached. */
export function SettingsPage() {
  const { projectId = '' } = useParams();
  const { project, role, snapshot, isPending, error } = useDelivery(projectId);
  const isAdmin = canDeliver(role, 'manageSettings');

  return (
    <DeliveryPage
      projectId={projectId}
      module="Settings"
      title="Settings"
      description="Project details and the workflow rules the delivery modules enforce."
    >
      <Loading isPending={isPending} error={error} />
      {project && snapshot ? (
        <div className="max-w-3xl space-y-6">
          {!isAdmin ? <Alert tone="info">Only project administrators can change settings.</Alert> : null}
          <ProjectDetails
            key={project.updated_at}
            id={project.id}
            name={project.name}
            description={project.description}
            disabled={!isAdmin}
          />
          <WorkflowSettings
            key={snapshot.settings.revision}
            projectId={projectId}
            settings={snapshot.settings}
            disabled={!isAdmin}
          />
          {backend.demo ? <DemoAiSettings /> : null}
        </div>
      ) : null}
    </DeliveryPage>
  );
}

function ProjectDetails({
  id,
  name,
  description,
  disabled,
}: {
  id: string;
  name: string;
  description: string;
  disabled: boolean;
}) {
  const [value, setValue] = useState({ name, description });
  const update = useUpdateProject();
  return (
    <Section title="Project">
      <div className="space-y-3">
        <Field label="Project name">
          {(fid) => (
            <Input
              id={fid}
              disabled={disabled}
              value={value.name}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Description">
          {(fid) => (
            <Textarea
              id={fid}
              rows={2}
              disabled={disabled}
              value={value.description}
              onChange={(e) => setValue({ ...value, description: e.target.value })}
            />
          )}
        </Field>
        {update.error ? <Alert tone="error">{errorMessage(update.error)}</Alert> : null}
        {!disabled ? (
          <Button
            variant="primary"
            loading={update.isPending}
            disabled={!value.name.trim() || (value.name === name && value.description === description)}
            onClick={() => update.mutate({ id, ...value })}
          >
            Save project
          </Button>
        ) : null}
      </div>
    </Section>
  );
}

function WorkflowSettings({
  projectId,
  settings,
  disabled,
}: {
  projectId: string;
  settings: DeliverySettings;
  disabled: boolean;
}) {
  const [value, setValue] = useState(settings);
  const save = useDeliveryOp(projectId, 'updateSettings');
  const toggle = (
    key: 'strictWorkflow' | 'allowConcurrentSprints' | 'requireEstimateForDevelopment',
    label: string,
    hint: string,
  ) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        disabled={disabled}
        checked={value[key]}
        onChange={(e) => setValue({ ...value, [key]: e.target.checked })}
      />
      <span>
        <span className="font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );
  const dirty = JSON.stringify(value) !== JSON.stringify(settings);
  return (
    <Section title="Delivery workflow">
      <div className="space-y-3">
        {toggle(
          'strictWorkflow',
          'Move Kanban cards one column at a time',
          'Cards cannot skip columns going forward. Moving back is always allowed.',
        )}
        {toggle(
          'requireEstimateForDevelopment',
          'Require an assignee and estimate before development',
          'Stories cannot enter In Development without them.',
        )}
        {toggle(
          'allowConcurrentSprints',
          'Allow concurrent sprints per team',
          'By default only one sprint per team can be active.',
        )}
        <Field label="Default sprint capacity (hours)" className="max-w-xs">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              disabled={disabled}
              value={value.defaultSprintCapacityHours}
              onChange={(e) => setValue({ ...value, defaultSprintCapacityHours: Number(e.target.value) || 0 })}
            />
          )}
        </Field>
        {save.error ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
        {!disabled ? (
          <Button
            variant="primary"
            disabled={!dirty}
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                projectId,
                revision: settings.revision,
                patch: {
                  strictWorkflow: value.strictWorkflow,
                  allowConcurrentSprints: value.allowConcurrentSprints,
                  requireEstimateForDevelopment: value.requireEstimateForDevelopment,
                  defaultSprintCapacityHours: value.defaultSprintCapacityHours,
                },
              })
            }
          >
            Save workflow settings
          </Button>
        ) : null}
      </div>
    </Section>
  );
}

const MODE_TEXT = {
  claude_runtime: 'AI requests go to Claude through your claude.ai account.',
  own_key:
    'AI requests go directly from this browser to the Anthropic API with the key you entered. The key is kept only for this browser tab.',
  samples:
    'AI features answer with built-in sample responses, so you can try every screen without an account. Results are labelled as samples.',
} as const;

function DemoAiSettings() {
  const qc = useQueryClient();
  const demo = backend.demo!;
  const mode = useQuery({ queryKey: ['demo-ai-mode'], queryFn: () => demo.ai.mode() });
  const [key, setKey] = useState('');
  return (
    <Section title="AI in this demo">
      {mode.data ? <p className="text-sm text-slate-700">{MODE_TEXT[mode.data]}</p> : null}
      {mode.data !== 'claude_runtime' ? (
        <div className="mt-3 space-y-2">
          <Alert tone="warning">
            Only use your own Anthropic API key on a device you trust. The real ProductFlow app never puts keys in the browser:
            its API server holds the key.
          </Alert>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              demo.ai.setKey(key);
              setKey('');
              void qc.invalidateQueries({ queryKey: ['demo-ai-mode'] });
            }}
          >
            <Field label="Anthropic API key" className="min-w-64 flex-1">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="sk-ant-…"
                />
              )}
            </Field>
            <Button type="submit" disabled={!key.trim()}>
              Use my key
            </Button>
            {demo.ai.hasKey() ? (
              <Button
                variant="ghost"
                onClick={() => {
                  demo.ai.setKey(null);
                  void qc.invalidateQueries({ queryKey: ['demo-ai-mode'] });
                }}
              >
                Forget key, use samples
              </Button>
            ) : null}
          </form>
        </div>
      ) : null}
    </Section>
  );
}
