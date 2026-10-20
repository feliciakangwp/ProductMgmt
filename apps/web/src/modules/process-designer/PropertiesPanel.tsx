import {
  EDGE_BRANCHES,
  NODE_TYPE_LABELS,
  removeEdges,
  removeNodes,
  updateEdge,
  updateNode,
  type Actor,
  type ActorKind,
  type EdgeBranch,
  type ProcessGraph,
  type ProcessNodeType,
} from '@productflow/domain';
import { ArrowRight, MousePointerClick, Plus, Quote, Sparkles, Table2, Trash2 } from 'lucide-react';
import { useState, type Dispatch } from 'react';
import { Link } from 'react-router';
import { Alert, Badge, Button, Field, Input, Select, Textarea } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useCreateActor } from './api';
import type { DesignerAction, Selection } from './designer-state';

const CHANGEABLE_TYPES: ProcessNodeType[] = ['activity', 'decision', 'approval', 'system'];
const BRANCH_LABELS: Record<EdgeBranch, string> = { yes: 'Yes', no: 'No', other: 'Other outcome' };

export function PropertiesPanel({
  projectId,
  graph,
  actors,
  selection,
  readOnly,
  dispatch,
  dataLink,
}: {
  /** Address of the activity's inputs and outputs, once the map is saved. */
  dataLink?: (nodeKey: string) => string | null;
  projectId: string;
  graph: ProcessGraph;
  actors: Actor[];
  selection: Selection;
  readOnly: boolean;
  dispatch: Dispatch<DesignerAction>;
}) {
  if (!selection) {
    return (
      <div className="flex flex-col items-center px-4 py-10 text-center text-sm text-slate-500">
        <MousePointerClick className="mb-2 size-6 text-slate-300" />
        Select an activity, decision or connection on the map to see and edit its properties.
      </div>
    );
  }
  if (selection.kind === 'node') {
    return (
      <NodeProperties
        key={selection.key}
        projectId={projectId}
        graph={graph}
        actors={actors}
        nodeKey={selection.key}
        readOnly={readOnly}
        dispatch={dispatch}
        dataLink={dataLink?.(selection.key) ?? null}
      />
    );
  }
  return <EdgeProperties key={selection.key} graph={graph} edgeKey={selection.key} readOnly={readOnly} dispatch={dispatch} />;
}

function NodeProperties({
  projectId,
  graph,
  actors,
  nodeKey,
  readOnly,
  dispatch,
  dataLink,
}: {
  dataLink: string | null;
  projectId: string;
  graph: ProcessGraph;
  actors: Actor[];
  nodeKey: string;
  readOnly: boolean;
  dispatch: Dispatch<DesignerAction>;
}) {
  const node = graph.nodes.find((n) => n.elementKey === nodeKey);
  const [addingActor, setAddingActor] = useState(false);
  if (!node) return null;
  const isEvent = node.type === 'start' || node.type === 'end';
  const edit = (field: string, patch: Parameters<typeof updateNode>[2]) =>
    dispatch({ type: 'updateGraph', update: (g) => updateNode(g, nodeKey, patch), history: `group:${nodeKey}:${field}` });
  const incoming = graph.edges.filter((e) => e.target === nodeKey).length;
  const outgoing = graph.edges.filter((e) => e.source === nodeKey).length;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="blue">{NODE_TYPE_LABELS[node.type]}</Badge>
          <span className="font-mono text-xs text-slate-500">{node.refCode ?? 'Assigned on save'}</span>
        </div>
        {node.origin === 'inferred' ? (
          <Badge tone="violet" title="Not stated in the description. Confirm or correct it before approval.">
            <Sparkles className="size-3" /> Inferred
          </Badge>
        ) : node.origin === 'stated' ? (
          <Badge tone="green" title="Taken from the process description">
            From description
          </Badge>
        ) : null}
      </div>

      <Field label={node.type === 'decision' ? 'Decision question' : 'Name'}>
        {(id) => (
          <Input
            id={id}
            value={node.label}
            maxLength={300}
            disabled={readOnly}
            onChange={(e) => edit('label', { label: e.target.value })}
          />
        )}
      </Field>

      {isEvent ? null : (
        <Field label="Type">
          {(id) => (
            <Select
              id={id}
              value={node.type}
              disabled={readOnly}
              onChange={(e) =>
                dispatch({
                  type: 'updateGraph',
                  update: (g) => updateNode(g, nodeKey, { type: e.target.value as ProcessNodeType }),
                })
              }
            >
              {CHANGEABLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {NODE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      {isEvent ? null : (
        <div className="space-y-2">
          <Field
            label="Responsible actor"
            hint={node.type === 'system' ? 'The system or service that performs this step.' : undefined}
          >
            {(id) => (
              <Select
                id={id}
                value={node.actorId ?? ''}
                disabled={readOnly}
                onChange={(e) =>
                  dispatch({ type: 'updateGraph', update: (g) => updateNode(g, nodeKey, { actorId: e.target.value || null }) })
                }
              >
                <option value="">Not assigned</option>
                {actors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.kind !== 'role' ? ` (${a.kind})` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {readOnly ? null : addingActor ? (
            <NewActorForm
              projectId={projectId}
              defaultKind={node.type === 'system' ? 'system' : 'role'}
              onCancel={() => setAddingActor(false)}
              onCreated={(actor) => {
                setAddingActor(false);
                dispatch({ type: 'updateGraph', update: (g) => updateNode(g, nodeKey, { actorId: actor.id }) });
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingActor(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
            >
              <Plus className="size-3" /> New actor
            </button>
          )}
        </div>
      )}

      <Field label="Description">
        {(id) => (
          <Textarea
            id={id}
            rows={4}
            value={node.description}
            maxLength={5000}
            disabled={readOnly}
            onChange={(e) => edit('description', { description: e.target.value })}
          />
        )}
      </Field>

      {node.sourceText ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <p className="mb-1 flex items-center gap-1 font-medium text-slate-500">
            <Quote className="size-3" /> From the description
          </p>
          “{node.sourceText}”
        </div>
      ) : null}

      <p className="text-xs text-slate-500">
        {incoming} incoming · {outgoing} outgoing connection{outgoing === 1 ? '' : 's'}
      </p>

      {!isEvent && dataLink ? (
        <Link to={dataLink} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          <Table2 className="size-3.5" /> Inputs &amp; outputs of this activity
        </Link>
      ) : null}

      {readOnly ? null : (
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 className="size-3.5" />}
          onClick={() => dispatch({ type: 'updateGraph', update: (g) => removeNodes(g, [nodeKey]) })}
        >
          Delete {NODE_TYPE_LABELS[node.type].toLowerCase()}
        </Button>
      )}
    </div>
  );
}

function NewActorForm({
  projectId,
  defaultKind,
  onCreated,
  onCancel,
}: {
  projectId: string;
  defaultKind: ActorKind;
  onCreated: (actor: Actor) => void;
  onCancel: () => void;
}) {
  const create = useCreateActor(projectId);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ActorKind>(defaultKind);
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
      {create.error ? <Alert tone="error">{errorMessage(create.error)}</Alert> : null}
      <div className="flex gap-2">
        <Input
          aria-label="Actor name"
          placeholder="e.g. Finance Director"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          className="h-8"
        />
        <Select aria-label="Actor kind" value={kind} onChange={(e) => setKind(e.target.value as ActorKind)} className="h-8 w-28">
          <option value="role">Role</option>
          <option value="system">System</option>
          <option value="external">External</option>
        </Select>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!name.trim()}
          loading={create.isPending}
          onClick={() => create.mutate({ name, kind }, { onSuccess: onCreated })}
        >
          Add actor
        </Button>
      </div>
    </div>
  );
}

function EdgeProperties({
  graph,
  edgeKey,
  readOnly,
  dispatch,
}: {
  graph: ProcessGraph;
  edgeKey: string;
  readOnly: boolean;
  dispatch: Dispatch<DesignerAction>;
}) {
  const edge = graph.edges.find((e) => e.elementKey === edgeKey);
  if (!edge) return null;
  const source = graph.nodes.find((n) => n.elementKey === edge.source);
  const target = graph.nodes.find((n) => n.elementKey === edge.target);
  const fromDecision = source?.type === 'decision' || source?.type === 'approval';
  const edit = (field: string, patch: Parameters<typeof updateEdge>[2]) =>
    dispatch({ type: 'updateGraph', update: (g) => updateEdge(g, edgeKey, patch), history: `group:${edgeKey}:${field}` });

  return (
    <div className="space-y-4 p-4">
      <Badge tone="blue">Connection</Badge>
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 text-slate-700" title={source?.label}>
          {source?.label ?? '?'}
        </span>
        <ArrowRight className="size-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 text-slate-700" title={target?.label}>
          {target?.label ?? '?'}
        </span>
      </div>
      <p className="text-xs text-slate-500">Drag either end of the connection on the map to reconnect it.</p>

      {fromDecision ? (
        <Field label="Outcome">
          {(id) => (
            <Select
              id={id}
              value={edge.branch ?? ''}
              disabled={readOnly}
              onChange={(e) => {
                const branch = (e.target.value || null) as EdgeBranch | null;
                const label = branch === 'yes' ? 'Yes' : branch === 'no' ? 'No' : edge.label;
                const keepLabel = edge.label && edge.label !== 'Yes' && edge.label !== 'No';
                dispatch({
                  type: 'updateGraph',
                  update: (g) => updateEdge(g, edgeKey, { branch, label: keepLabel ? edge.label : label }),
                });
              }}
            >
              <option value="">Not specified</option>
              {EDGE_BRANCHES.map((b) => (
                <option key={b} value={b}>
                  {BRANCH_LABELS[b]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      <Field label="Label" hint="Shown on the map.">
        {(id) => (
          <Input
            id={id}
            value={edge.label}
            maxLength={200}
            disabled={readOnly}
            onChange={(e) => edit('label', { label: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="Condition"
        hint={fromDecision ? 'When is this path taken? e.g. "Debt outstanding more than 5 years".' : 'Optional.'}
      >
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            value={edge.condition}
            maxLength={2000}
            disabled={readOnly}
            onChange={(e) => edit('condition', { condition: e.target.value })}
          />
        )}
      </Field>

      {readOnly ? null : (
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 className="size-3.5" />}
          onClick={() => dispatch({ type: 'updateGraph', update: (g) => removeEdges(g, [edgeKey]) })}
        >
          Delete connection
        </Button>
      )}
    </div>
  );
}
