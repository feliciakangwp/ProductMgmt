import { createNode, type ProcessEdge, type ProcessGraph, type ValidationIssue } from '@productflow/domain';
import { describe, expect, it } from 'vitest';
import { edgeDisplayLabel, isLoopBack, severityByNode, toFlowEdges, toFlowNodes } from '../flow-mapping';

const start = createNode('start', { x: 0, y: 0 });
const review = { ...createNode('approval', { x: 0, y: 300 }, 'Review'), actorId: 'a1' };
const retrieve = createNode('activity', { x: 0, y: 150 }, 'Retrieve');
const edge = (source: string, target: string, patch: Partial<ProcessEdge> = {}): ProcessEdge => ({
  elementKey: `${source}->${target}`,
  source,
  target,
  label: '',
  condition: '',
  branch: null,
  ...patch,
});
const graph: ProcessGraph = {
  nodes: [start, retrieve, review],
  edges: [
    edge(start.elementKey, retrieve.elementKey),
    edge(retrieve.elementKey, review.elementKey),
    edge(review.elementKey, retrieve.elementKey, { branch: 'no', label: 'Rejected' }),
  ],
};
const issue = (severity: 'error' | 'warning', nodeKeys: string[]): ValidationIssue => ({
  id: `${severity}${nodeKeys.join()}`,
  code: 'MISSING_ACTOR',
  severity,
  message: '',
  nodeKeys,
  edgeKeys: [],
  findingIds: [],
});

describe('toFlowNodes', () => {
  it('projects nodes with fixed dimensions, actor names, selection and severity', () => {
    const nodes = toFlowNodes({
      graph,
      actors: [{ id: 'a1', name: 'Supervisor', kind: 'role' }],
      issues: [issue('warning', [retrieve.elementKey]), issue('error', [retrieve.elementKey])],
      selection: { kind: 'node', key: review.elementKey },
      readOnly: false,
    });
    expect(nodes.map((n) => n.type)).toEqual(['start', 'activity', 'approval']);
    expect(nodes[2]).toMatchObject({ selected: true, width: 200, height: 76, data: { actorName: 'Supervisor' } });
    expect(nodes[1]!.data.severity).toBe('error');
    expect(nodes[0]!.data.severity).toBeNull();
  });

  it('locks nodes in read-only mode', () => {
    const [node] = toFlowNodes({ graph, actors: [], issues: [], selection: null, readOnly: true });
    expect(node).toMatchObject({ draggable: false, connectable: false, deletable: false });
  });
});

describe('toFlowEdges', () => {
  it('routes loops back to earlier steps through the side handles', () => {
    const nodes = new Map(graph.nodes.map((n) => [n.elementKey, n]));
    expect(graph.edges.map((e) => isLoopBack(e, nodes))).toEqual([false, false, true]);
    const edges = toFlowEdges({ graph, selection: null, readOnly: false });
    expect(edges[2]).toMatchObject({ sourceHandle: 'loop-out', targetHandle: 'loop-in', label: 'Rejected' });
    expect(edges[0]).toMatchObject({ sourceHandle: null, targetHandle: null });
    expect(edges[2]!.style).toEqual({ stroke: '#dc2626' });
  });

  it('labels edges from their label, then their condition', () => {
    expect(edgeDisplayLabel(edge('a', 'b', { label: 'Yes', condition: 'x' }))).toBe('Yes');
    expect(edgeDisplayLabel(edge('a', 'b', { condition: 'Amount over $10,000' }))).toBe('Amount over $10,000');
    expect(edgeDisplayLabel(edge('a', 'b', { condition: 'x'.repeat(60) }))).toHaveLength(40);
  });
});

describe('severityByNode', () => {
  it('keeps the highest severity per node', () => {
    const map = severityByNode([issue('error', ['a']), issue('warning', ['a', 'b'])]);
    expect(map.get('a')).toBe('error');
    expect(map.get('b')).toBe('warning');
  });
});
