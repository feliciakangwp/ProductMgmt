import { addNode, createNode, moveNodes, updateNode, type ProcessFinding, type ProcessGraph } from '@productflow/domain';
import { describe, expect, it } from 'vitest';
import { designerReducer, HISTORY_LIMIT, initialDesignerState, type DesignerAction, type DesignerState } from '../designer-state';

const start = createNode('start', { x: 0, y: 0 });
const task = createNode('activity', { x: 0, y: 100 }, 'Retrieve debt record');
const baseGraph: ProcessGraph = { nodes: [start, task], edges: [] };

function loaded(): DesignerState {
  return designerReducer(initialDesignerState, {
    type: 'load',
    versionId: 'v1',
    revision: 3,
    description: 'Original description',
    graph: baseGraph,
    findings: [],
  });
}

const run = (state: DesignerState, ...actions: DesignerAction[]) => actions.reduce(designerReducer, state);

const finding = (patch: Partial<ProcessFinding>): ProcessFinding => ({
  elementKey: crypto.randomUUID(),
  kind: 'business_rule',
  statement: 'Rule',
  sourceText: null,
  origin: 'inferred',
  status: 'draft',
  relatedNodeKeys: [],
  ...patch,
});

describe('designerReducer', () => {
  it('loads a clean state', () => {
    const state = loaded();
    expect(state).toMatchObject({ versionId: 'v1', revision: 3, dirty: false, past: [], future: [] });
  });

  it('marks edits dirty and supports undo and redo', () => {
    const extra = createNode('end', { x: 0, y: 200 });
    let state = run(loaded(), { type: 'updateGraph', update: (g) => addNode(g, extra) });
    expect(state.dirty).toBe(true);
    expect(state.graph.nodes).toHaveLength(3);
    state = run(state, { type: 'undo' });
    expect(state.graph).toBe(baseGraph);
    expect(state.future).toHaveLength(1);
    state = run(state, { type: 'redo' });
    expect(state.graph.nodes).toHaveLength(3);
    expect(run(state, { type: 'redo' })).toBe(state);
  });

  it('groups consecutive typing in one field into a single undo step', () => {
    let state = loaded();
    for (const label of ['R', 'Re', 'Rev', 'Review']) {
      state = run(state, {
        type: 'updateGraph',
        update: (g) => updateNode(g, task.elementKey, { label }),
        history: `group:${task.elementKey}:label`,
      });
    }
    expect(state.past).toHaveLength(1);
    state = run(state, { type: 'undo' });
    expect(state.graph.nodes[1]!.label).toBe('Retrieve debt record');
  });

  it('starts a new undo step after the selection changes', () => {
    const edit = (label: string): DesignerAction => ({
      type: 'updateGraph',
      update: (g) => updateNode(g, task.elementKey, { label }),
      history: `group:${task.elementKey}:label`,
    });
    const state = run(loaded(), edit('A'), { type: 'select', selection: { kind: 'node', key: task.elementKey } }, edit('AB'));
    expect(state.past).toHaveLength(2);
  });

  it('records a drag as one undo step via checkpoint', () => {
    let state = run(loaded(), { type: 'checkpoint' });
    for (let x = 1; x <= 5; x++) {
      state = run(state, {
        type: 'updateGraph',
        update: (g) => moveNodes(g, { [task.elementKey]: { x, y: 100 } }),
        history: 'none',
      });
    }
    expect(state.past).toHaveLength(1);
    state = run(state, { type: 'undo' });
    expect(state.graph.nodes[1]!.position).toEqual({ x: 0, y: 100 });
  });

  it('caps the undo history', () => {
    let state = loaded();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      state = run(state, { type: 'updateGraph', update: (g) => updateNode(g, task.elementKey, { label: `L${i}` }) });
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT);
  });

  it('ignores no-op updates', () => {
    const state = loaded();
    expect(run(state, { type: 'updateGraph', update: (g) => g })).toBe(state);
    expect(run(state, { type: 'setDescription', description: 'Original description' })).toBe(state);
  });

  it('clears a selection whose element was removed', () => {
    const state = run(
      loaded(),
      { type: 'select', selection: { kind: 'node', key: task.elementKey } },
      { type: 'updateGraph', update: (g) => ({ ...g, nodes: g.nodes.filter((n) => n !== task) }) },
    );
    expect(state.selection).toBeNull();
  });

  it('accepting a proposal replaces the map and AI draft findings but keeps analyst findings', () => {
    const manual = finding({ origin: 'manual', status: 'accepted', statement: 'Mine' });
    const reviewed = finding({ status: 'dismissed', statement: 'Reviewed AI finding' });
    const oldDraft = finding({ statement: 'Old AI draft' });
    const fresh = finding({ statement: 'New AI draft' });
    const proposal: ProcessGraph = { nodes: [createNode('start', { x: 0, y: 0 })], edges: [] };
    let state = run(loaded(), { type: 'updateFindings', update: () => [manual, reviewed, oldDraft] });
    state = run(state, { type: 'acceptProposal', graph: proposal, findings: [fresh], analysisRunId: 'run-1' });
    expect(state.graph).toBe(proposal);
    expect(state.findings.map((f) => f.statement)).toEqual(['Mine', 'Reviewed AI finding', 'New AI draft']);
    expect(state.analysisRunId).toBe('run-1');
    expect(state.dirty).toBe(true);
    // Accepting is undoable before saving.
    state = run(state, { type: 'undo' });
    expect(state.graph).toBe(baseGraph);
  });

  it('a completed save clears dirty only if nothing changed while it was in flight', () => {
    const edited = run(loaded(), { type: 'setDescription', description: 'New' });
    const sent = { description: edited.description, graph: edited.graph, findings: edited.findings, analysisRunId: null };

    const clean = run(edited, { type: 'saved', revision: 4, ...sent });
    expect(clean).toMatchObject({ dirty: false, revision: 4 });

    const changedMeanwhile = run(
      edited,
      { type: 'setDescription', description: 'Newer' },
      { type: 'saved', revision: 4, ...sent },
    );
    expect(changedMeanwhile).toMatchObject({ dirty: true, revision: 4, description: 'Newer' });
  });

  it('clears the accepted analysis run once a save includes it', () => {
    const accepted = run(loaded(), { type: 'acceptProposal', graph: baseGraph, findings: [], analysisRunId: 'run-1' });
    const sent = { description: accepted.description, graph: accepted.graph, findings: accepted.findings };
    expect(run(accepted, { type: 'saved', revision: 4, ...sent, analysisRunId: 'run-1' }).analysisRunId).toBeNull();
    expect(run(accepted, { type: 'saved', revision: 4, ...sent, analysisRunId: null }).analysisRunId).toBe('run-1');
  });

  it('fills in database ref codes without creating history or dirtying the editor', () => {
    const extra = createNode('activity', { x: 0, y: 200 }, 'New');
    let state = run(loaded(), { type: 'updateGraph', update: (g) => addNode(g, extra) });
    const sent = { description: state.description, graph: state.graph, findings: state.findings, analysisRunId: null };
    state = run(state, { type: 'saved', revision: 4, ...sent });
    const pastLength = state.past.length;
    state = run(state, { type: 'applyRefCodes', refCodes: { [extra.elementKey]: 'ACT-007' } });
    expect(state.graph.nodes.find((n) => n.elementKey === extra.elementKey)?.refCode).toBe('ACT-007');
    expect(state.dirty).toBe(false);
    expect(state.past).toHaveLength(pastLength);
  });

  it('restores a backup as an undoable, unsaved change', () => {
    const backupGraph: ProcessGraph = { nodes: [start], edges: [] };
    const state = run(loaded(), { type: 'restore', description: 'Recovered', graph: backupGraph, findings: [] });
    expect(state).toMatchObject({ description: 'Recovered', dirty: true });
    expect(run(state, { type: 'undo' }).graph).toBe(baseGraph);
  });
});
