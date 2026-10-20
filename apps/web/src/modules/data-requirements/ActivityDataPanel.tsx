import {
  DATA_TYPE_LABELS,
  FIELD_SOURCE_LABELS,
  MANDATORY_OPTIONS,
  NODE_TYPE_LABELS,
  newKey,
  OUTPUT_KIND_LABELS,
  OUTPUT_KINDS,
  type Actor,
  type ActivityField,
  type FieldDefinition,
  type IoDirection,
  type OutputKind,
  type ProcessGraph,
  type ProcessNode,
  type ValidationRule,
} from '@productflow/domain';
import { ArrowRight, ExternalLink, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Dispatch, ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, Button, IconButton, Input, Select } from '../../components/ui';
import { FieldPicker } from './FieldPicker';
import { MANDATORY_LABELS } from './format';
import { nextSortOrder, type IoAction, type IoState } from './io-state';

export function ActivityDataPanel({
  projectId,
  processId,
  versionId,
  node,
  graph,
  actors,
  state,
  fields,
  rules,
  readOnly,
  dispatch,
  onOpenField,
}: {
  projectId: string;
  processId: string;
  versionId: string;
  node: ProcessNode;
  graph: ProcessGraph;
  actors: Actor[];
  state: IoState;
  fields: FieldDefinition[];
  rules: ValidationRule[];
  readOnly: boolean;
  dispatch: Dispatch<IoAction>;
  onOpenField: (fieldId: string) => void;
}) {
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const uses = state.requirements.fields.filter((f) => f.nodeKey === node.elementKey);
  const outputs = state.requirements.outputs.filter((o) => o.nodeKey === node.elementKey);
  const actor = actors.find((a) => a.id === node.actorId);
  const next = graph.edges
    .filter((e) => e.source === node.elementKey)
    .map((e) => ({ edge: e, target: graph.nodes.find((n) => n.elementKey === e.target) }))
    .filter((x) => x.target);

  const add = (field: FieldDefinition, direction: IoDirection) =>
    dispatch({
      type: 'addField',
      field: {
        elementKey: newKey(),
        nodeKey: node.elementKey,
        fieldId: field.id,
        direction,
        mandatory: direction === 'input' ? 'yes' : 'no',
        mandatoryCondition: '',
        notes: '',
        origin: 'manual',
        sortOrder: nextSortOrder(state.requirements.fields, node.elementKey),
      },
    });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono">{node.refCode ?? 'new'}</span>
            <Badge tone="blue">{NODE_TYPE_LABELS[node.type]}</Badge>
            {actor ? <span>Performed by {actor.name}</span> : <span className="text-amber-700">No responsible actor</span>}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{node.label}</h2>
          {node.description ? <p className="mt-0.5 text-sm text-slate-600">{node.description}</p> : null}
        </div>
        <Link
          to={`/projects/${projectId}/processes/${processId}?version=${versionId}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
        >
          Open in Process Designer <ExternalLink className="size-3" />
        </Link>
      </header>

      {(['input', 'output'] as const).map((direction) => {
        const rows = uses.filter((u) => u.direction === direction);
        const used = new Set(rows.map((r) => r.fieldId));
        return (
          <Section
            key={direction}
            title={direction === 'input' ? 'Input fields' : 'Output fields'}
            hint={direction === 'input' ? 'Data the activity reads or captures.' : 'Values the activity creates or changes.'}
          >
            {rows.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Field</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Source</th>
                      {direction === 'input' ? <th className="px-3 py-2">Mandatory</th> : null}
                      <th className="px-3 py-2">Rules</th>
                      <th className="w-10 px-3 py-2">
                        <span className="sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((use) => (
                      <FieldRow
                        key={use.elementKey}
                        use={use}
                        field={fieldById.get(use.fieldId)}
                        ruleCount={rules.filter((r) => r.fieldId === use.fieldId).length}
                        readOnly={readOnly}
                        dispatch={dispatch}
                        onOpenField={onOpenField}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-xs text-slate-500">
                No {direction === 'input' ? 'input' : 'output'} fields yet.
              </p>
            )}
            {readOnly ? null : (
              <FieldPicker
                projectId={projectId}
                fields={fields}
                exclude={used}
                label={direction === 'input' ? 'Add input field' : 'Add output field'}
                onPick={(f) => add(f, direction)}
              />
            )}
          </Section>
        );
      })}

      <Section title="Other outputs" hint="Records updated, documents generated, notifications sent and status changes.">
        {outputs.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-xs text-slate-500">No other outputs.</p>
        ) : (
          <ul className="space-y-2">
            {outputs.map((o) => (
              <li
                key={o.elementKey}
                className="grid gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[11rem_1fr_1fr_auto]"
              >
                <Select
                  aria-label="Output type"
                  className="h-8"
                  value={o.kind}
                  disabled={readOnly}
                  onChange={(e) =>
                    dispatch({ type: 'updateOutput', elementKey: o.elementKey, patch: { kind: e.target.value as OutputKind } })
                  }
                >
                  {OUTPUT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {OUTPUT_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label="Output target"
                  className="h-8"
                  placeholder="Record, document, recipient or new status"
                  value={o.target}
                  maxLength={300}
                  disabled={readOnly}
                  onChange={(e) =>
                    dispatch({ type: 'updateOutput', elementKey: o.elementKey, patch: { target: e.target.value } })
                  }
                />
                <Input
                  aria-label="Output description"
                  className="h-8"
                  placeholder="Description"
                  value={o.description}
                  maxLength={2000}
                  disabled={readOnly}
                  onChange={(e) =>
                    dispatch({ type: 'updateOutput', elementKey: o.elementKey, patch: { description: e.target.value } })
                  }
                />
                <div className="flex items-center gap-1">
                  {o.origin === 'inferred' ? <AiBadge /> : null}
                  {readOnly ? null : (
                    <IconButton
                      label="Remove output"
                      icon={<Trash2 className="size-3.5" />}
                      onClick={() => dispatch({ type: 'removeOutput', elementKey: o.elementKey })}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {readOnly ? null : (
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="size-3.5" />}
            onClick={() =>
              dispatch({
                type: 'addOutput',
                output: {
                  elementKey: newKey(),
                  nodeKey: node.elementKey,
                  kind: 'record_update',
                  target: '',
                  description: '',
                  origin: 'manual',
                  sortOrder: nextSortOrder(state.requirements.outputs, node.elementKey),
                },
              })
            }
          >
            Add output
          </Button>
        )}
      </Section>

      <Section title="Next activity" hint="Taken from the process map.">
        {next.length === 0 ? (
          <p className="text-xs text-slate-500">This activity has no outgoing connection.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {next.map(({ edge, target }) => (
              <li key={edge.elementKey} className="flex items-center gap-2 text-slate-700">
                <ArrowRight className="size-3.5 text-slate-400" />
                {edge.label || edge.condition ? <Badge>{edge.label || edge.condition}</Badge> : null}
                <span className="font-mono text-xs text-slate-500">{target!.refCode ?? ''}</span>
                {target!.label}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function FieldRow({
  use,
  field,
  ruleCount,
  readOnly,
  dispatch,
  onOpenField,
}: {
  use: ActivityField;
  field: FieldDefinition | undefined;
  ruleCount: number;
  readOnly: boolean;
  dispatch: Dispatch<IoAction>;
  onOpenField: (fieldId: string) => void;
}) {
  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        {field ? (
          <button type="button" className="text-left" onClick={() => onOpenField(field.id)}>
            <span className="block font-mono text-[11px] text-slate-400">{field.refCode}</span>
            <span className="font-medium text-brand-800 hover:underline">{field.name}</span>
          </button>
        ) : (
          <span className="text-red-700">Missing field</span>
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          {field?.status === 'draft' ? (
            <Badge tone="amber" title="Confirm this field in the data dictionary">
              Draft
            </Badge>
          ) : null}
          {field?.status === 'deprecated' ? <Badge tone="red">Deprecated</Badge> : null}
          {use.origin === 'inferred' ? <AiBadge /> : null}
        </div>
      </td>
      <td className="px-3 py-2 text-slate-600">{field ? DATA_TYPE_LABELS[field.dataType] : ''}</td>
      <td className="px-3 py-2 text-xs text-slate-600">
        {field ? FIELD_SOURCE_LABELS[field.source] : ''}
        {field?.sourceDetail ? <span className="block text-slate-400">{field.sourceDetail}</span> : null}
      </td>
      {use.direction === 'input' ? (
        <td className="min-w-48 px-3 py-2">
          <Select
            aria-label={`Mandatory: ${field?.name ?? ''}`}
            className="h-8"
            value={use.mandatory}
            disabled={readOnly}
            onChange={(e) =>
              dispatch({
                type: 'updateField',
                elementKey: use.elementKey,
                patch: { mandatory: e.target.value as ActivityField['mandatory'] },
              })
            }
          >
            {MANDATORY_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {MANDATORY_LABELS[m]}
              </option>
            ))}
          </Select>
          {use.mandatory === 'conditional' ? (
            <Input
              aria-label={`Condition: ${field?.name ?? ''}`}
              className="mt-1 h-8"
              placeholder="When is it required?"
              value={use.mandatoryCondition}
              maxLength={1000}
              disabled={readOnly}
              onChange={(e) =>
                dispatch({ type: 'updateField', elementKey: use.elementKey, patch: { mandatoryCondition: e.target.value } })
              }
            />
          ) : null}
        </td>
      ) : null}
      <td className="px-3 py-2 text-xs">
        {field ? (
          <button type="button" className="text-brand-700 hover:underline" onClick={() => onOpenField(field.id)}>
            {ruleCount === 0 ? 'Add rules' : `${ruleCount} rule${ruleCount > 1 ? 's' : ''}`}
          </button>
        ) : null}
      </td>
      <td className="px-3 py-2">
        {readOnly ? null : (
          <IconButton
            label={`Remove ${field?.name ?? 'field'}`}
            icon={<Trash2 className="size-3.5" />}
            onClick={() => dispatch({ type: 'removeField', elementKey: use.elementKey })}
          />
        )}
      </td>
    </tr>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      {children}
    </section>
  );
}

export function AiBadge() {
  return (
    <Badge tone="violet" title="Suggested by AI and inferred rather than stated in the description">
      <Sparkles className="size-3" /> AI
    </Badge>
  );
}
