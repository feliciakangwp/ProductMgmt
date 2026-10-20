import { Graph, layout } from '@dagrejs/dagre';
import type { Position, ProcessEdge, ProcessNode, ProcessNodeType } from './types';

export type LayoutDirection = 'LR' | 'TB';

/** Rendered size of each node type; the canvas components use the same values. */
export const NODE_DIMENSIONS: Record<ProcessNodeType, { width: number; height: number }> = {
  start: { width: 56, height: 56 },
  end: { width: 56, height: 56 },
  activity: { width: 200, height: 76 },
  approval: { width: 200, height: 76 },
  system: { width: 200, height: 76 },
  decision: { width: 128, height: 128 },
};

/**
 * Process maps flow top to bottom: the designer's canvas sits between two
 * side panels, so it is taller than it is wide.
 *
 * Computes top-left positions for every node with Dagre. Returns a new node
 * array; the input is not modified. Edges pointing at unknown nodes are
 * ignored rather than letting Dagre invent placeholder nodes.
 */
export function layoutGraph<T extends ProcessNode>(nodes: T[], edges: ProcessEdge[], direction: LayoutDirection = 'TB'): T[] {
  if (nodes.length === 0) return [];

  const g = new Graph({ multigraph: true });
  g.setGraph({ rankdir: direction, nodesep: 56, ranksep: 64, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.elementKey, { ...NODE_DIMENSIONS[node.type] });
  }
  const keys = new Set(nodes.map((n) => n.elementKey));
  for (const edge of edges) {
    if (keys.has(edge.source) && keys.has(edge.target)) {
      g.setEdge(edge.source, edge.target, {}, edge.elementKey);
    }
  }

  layout(g);

  return nodes.map((node) => {
    const laidOut = g.node(node.elementKey) as { x: number; y: number } | undefined;
    const size = NODE_DIMENSIONS[node.type];
    const position: Position = laidOut
      ? { x: Math.round(laidOut.x - size.width / 2), y: Math.round(laidOut.y - size.height / 2) }
      : node.position;
    return { ...node, position };
  });
}
