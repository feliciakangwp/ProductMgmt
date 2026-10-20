import { describe, expect, it } from 'vitest';
import {
  addNode,
  connectNodes,
  createNode,
  edgeFromRow,
  graphFromRows,
  layoutGraph,
  moveNodes,
  nodeFromRow,
  reconnectEdge,
  removeEdges,
  removeNodes,
  toSavePayload,
  updateEdge,
  updateNode,
  type ProcessGraph,
} from '../index';

function sample(): ProcessGraph {
  const start = createNode('start', { x: 0, y: 0 });
  const decision = createNode('decision', { x: 100, y: 0 }, 'Eligible?');
  const end = createNode('end', { x: 200, y: 0 });
  return { nodes: [start, decision, end], edges: [] };
}

describe('graph operations', () => {
  it('connects nodes and assigns Yes then No to decision branches', () => {
    const g0 = sample();
    const [start, decision, end] = g0.nodes as [(typeof g0.nodes)[0], (typeof g0.nodes)[0], (typeof g0.nodes)[0]];
    const r1 = connectNodes(g0, start.elementKey, decision.elementKey);
    expect(r1.ok && r1.edge.branch).toBe(null);
    if (!r1.ok) return;
    const task = createNode('activity', { x: 0, y: 100 });
    const g1 = addNode(r1.graph, task);
    const yes = connectNodes(g1, decision.elementKey, task.elementKey);
    expect(yes.ok && [yes.edge.branch, yes.edge.label]).toEqual(['yes', 'Yes']);
    if (!yes.ok) return;
    const no = connectNodes(yes.graph, decision.elementKey, end.elementKey);
    expect(no.ok && [no.edge.branch, no.edge.label]).toEqual(['no', 'No']);
    expect(g0.edges).toHaveLength(0); // input untouched
  });

  it('rejects invalid connections', () => {
    const g = sample();
    const [start, decision, end] = g.nodes.map((n) => n.elementKey) as [string, string, string];
    expect(connectNodes(g, start, start)).toMatchObject({ ok: false });
    expect(connectNodes(g, end, decision)).toMatchObject({ ok: false, reason: expect.stringMatching(/end event/) });
    expect(connectNodes(g, decision, start)).toMatchObject({ ok: false, reason: expect.stringMatching(/start event/) });
    expect(connectNodes(g, start, 'missing')).toMatchObject({ ok: false });
    const r = connectNodes(g, start, decision);
    if (!r.ok) throw new Error('expected ok');
    expect(connectNodes(r.graph, start, decision)).toMatchObject({ ok: false, reason: expect.stringMatching(/already/) });
  });

  it('removes connections together with deleted nodes', () => {
    let g = sample();
    const [start, decision, end] = g.nodes.map((n) => n.elementKey) as [string, string, string];
    for (const [s, t] of [
      [start, decision],
      [decision, end],
    ] as const) {
      const r = connectNodes(g, s, t);
      if (!r.ok) throw new Error(r.reason);
      g = r.graph;
    }
    const after = removeNodes(g, [decision]);
    expect(after.nodes.map((n) => n.elementKey)).toEqual([start, end]);
    expect(after.edges).toEqual([]);
  });

  it('reconnects an edge keeping its identity and condition', () => {
    let g = sample();
    const [start, decision, end] = g.nodes.map((n) => n.elementKey) as [string, string, string];
    const task = createNode('activity', { x: 0, y: 0 });
    g = addNode(g, task);
    const r = connectNodes(g, decision, end);
    if (!r.ok) throw new Error(r.reason);
    g = updateEdge(r.graph, r.edge.elementKey, { condition: 'Amount > 0' });
    const moved = reconnectEdge(g, r.edge.elementKey, decision, task.elementKey);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.edge.elementKey).toBe(r.edge.elementKey);
    expect(moved.edge.condition).toBe('Amount > 0');
    expect(moved.edge.branch).toBe('yes');
    expect(moved.graph.edges).toHaveLength(1);
    expect(reconnectEdge(g, r.edge.elementKey, end, start)).toMatchObject({ ok: false });
  });

  it('updates and moves nodes immutably', () => {
    const g = sample();
    const key = g.nodes[1]!.elementKey;
    const renamed = updateNode(g, key, { label: 'Debt older than 5 years?', actorId: 'a1' });
    expect(renamed.nodes[1]).toMatchObject({ label: 'Debt older than 5 years?', actorId: 'a1' });
    expect(g.nodes[1]!.label).toBe('Eligible?');
    expect(updateNode(g, 'missing', { label: 'x' })).toBe(g);
    const moved = moveNodes(g, { [key]: { x: 5, y: 6 } });
    expect(moved.nodes[1]!.position).toEqual({ x: 5, y: 6 });
    expect(moved.nodes[0]).toBe(g.nodes[0]);
    expect(removeEdges(g, ['none'])).toBe(g);
    expect(removeNodes(g, ['none'])).toBe(g);
  });
});

describe('layoutGraph', () => {
  it('ignores dangling edges and returns positions for every node', () => {
    const g = sample();
    const laidOut = layoutGraph(g.nodes, [
      {
        elementKey: 'e1',
        source: g.nodes[0]!.elementKey,
        target: g.nodes[1]!.elementKey,
        label: '',
        condition: '',
        branch: null,
      },
      { elementKey: 'e2', source: g.nodes[1]!.elementKey, target: 'ghost', label: '', condition: '', branch: null },
    ]);
    expect(laidOut).toHaveLength(3);
    for (const n of laidOut) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
    expect(layoutGraph([], [])).toEqual([]);
  });
});

describe('persistence mapping', () => {
  it('round-trips nodes and edges through database rows', () => {
    let g = sample();
    const r = connectNodes(g, g.nodes[0]!.elementKey, g.nodes[1]!.elementKey);
    if (!r.ok) throw new Error(r.reason);
    g = r.graph;
    const payload = toSavePayload({ versionId: 'v1', expectedRevision: 3, description: 'desc', graph: g, findings: [] });
    const nodeRows = payload.p_nodes.map((n, i) => ({ ...n, id: `row${i}`, version_id: 'v1', ref_code: null }));
    const edgeRows = payload.p_edges.map((e, i) => ({ ...e, id: `edge${i}`, version_id: 'v1' }));
    expect(graphFromRows(nodeRows, edgeRows)).toEqual(g);
  });

  it('drops edges and finding references to nodes that do not exist', () => {
    const g = sample();
    g.edges.push({ elementKey: 'e', source: g.nodes[0]!.elementKey, target: 'ghost', label: '', condition: '', branch: null });
    const payload = toSavePayload({
      versionId: 'v1',
      expectedRevision: 1,
      description: '',
      graph: g,
      findings: [
        {
          elementKey: 'f',
          kind: 'exception',
          statement: 's',
          sourceText: null,
          origin: 'manual',
          status: 'draft',
          relatedNodeKeys: ['ghost', g.nodes[1]!.elementKey],
        },
      ],
      analysisRunId: 'run-1',
    });
    expect(payload.p_edges).toEqual([]);
    expect(payload.p_findings[0]!.related_node_keys).toEqual([g.nodes[1]!.elementKey]);
    expect(payload.p_analysis_run_id).toBe('run-1');
  });

  it('coerces numeric strings returned for positions', () => {
    const node = nodeFromRow({
      id: 'r',
      version_id: 'v',
      element_key: 'k',
      ref_code: 'ACT-001',
      node_type: 'activity',
      label: 'L',
      description: '',
      actor_id: null,
      position_x: '12.5' as unknown as number,
      position_y: 3,
      origin: 'manual',
      source_text: null,
    });
    expect(node.position).toEqual({ x: 12.5, y: 3 });
    expect(
      edgeFromRow({
        id: 'e',
        version_id: 'v',
        element_key: 'k',
        source_key: 'a',
        target_key: 'b',
        label: '',
        condition: '',
        branch: 'no',
      }),
    ).toMatchObject({ source: 'a', target: 'b', branch: 'no' });
  });
});
