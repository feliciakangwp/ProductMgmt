import { MarkerType, type Edge, type Node } from '@xyflow/react';
import {
  NODE_DIMENSIONS,
  type Actor,
  type IssueSeverity,
  type ProcessEdge,
  type ProcessGraph,
  type ProcessNode,
  type ValidationIssue,
} from '@productflow/domain';
import type { Selection } from './designer-state';

// Must match the handle ids in nodes.tsx.
const LOOP_SOURCE_HANDLE = 'loop-out';
const LOOP_TARGET_HANDLE = 'loop-in';

/**
 * Projection of the domain graph into React Flow nodes and edges. React Flow
 * never owns process data: every change it reports is translated back into a
 * domain graph operation.
 */

export type ProcessNodeData = {
  node: ProcessNode;
  actorName: string | null;
  severity: IssueSeverity | null;
  readOnly: boolean;
};

export type ProcessFlowNode = Node<ProcessNodeData, ProcessNode['type']>;

export type ProcessEdgeData = { edge: ProcessEdge };
export type ProcessFlowEdge = Edge<ProcessEdgeData>;

const BRANCH_COLOURS: Record<string, string> = {
  yes: '#059669',
  no: '#dc2626',
  other: '#7c3aed',
};
const DEFAULT_EDGE_COLOUR = '#64748b';

/** Highest severity per node key: errors win over warnings. */
export function severityByNode(issues: ValidationIssue[]): Map<string, IssueSeverity> {
  const map = new Map<string, IssueSeverity>();
  for (const issue of issues) {
    for (const key of issue.nodeKeys) {
      if (issue.severity === 'error' || !map.has(key)) map.set(key, issue.severity);
    }
  }
  return map;
}

export function toFlowNodes(args: {
  graph: ProcessGraph;
  actors: Actor[];
  issues: ValidationIssue[];
  selection: Selection;
  readOnly: boolean;
}): ProcessFlowNode[] {
  const actorName = new Map(args.actors.map((a) => [a.id, a.name]));
  const severity = severityByNode(args.issues);
  return args.graph.nodes.map((node) => {
    const size = NODE_DIMENSIONS[node.type];
    return {
      id: node.elementKey,
      type: node.type,
      position: node.position,
      width: size.width,
      height: size.height,
      selected: args.selection?.kind === 'node' && args.selection.key === node.elementKey,
      draggable: !args.readOnly,
      connectable: !args.readOnly,
      deletable: !args.readOnly,
      data: {
        node,
        actorName: node.actorId ? (actorName.get(node.actorId) ?? null) : null,
        severity: severity.get(node.elementKey) ?? null,
        readOnly: args.readOnly,
      },
    };
  });
}

export function edgeDisplayLabel(edge: ProcessEdge): string {
  const label = edge.label.trim();
  if (label) return label;
  const condition = edge.condition.trim();
  if (condition) return condition.length > 40 ? `${condition.slice(0, 39)}…` : condition;
  return '';
}

/**
 * A connection back to a step drawn above its source (a rework loop, such as a
 * rejection returning to an earlier step). These are routed along the right
 * side of the nodes instead of over the main top-to-bottom path.
 */
export function isLoopBack(edge: ProcessEdge, nodes: Map<string, ProcessNode>): boolean {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  if (!source || !target || source.type === 'start') return false;
  const sourceCentre = source.position.y + NODE_DIMENSIONS[source.type].height / 2;
  const targetCentre = target.position.y + NODE_DIMENSIONS[target.type].height / 2;
  return targetCentre < sourceCentre;
}

export function toFlowEdges(args: { graph: ProcessGraph; selection: Selection; readOnly: boolean }): ProcessFlowEdge[] {
  const nodes = new Map(args.graph.nodes.map((n) => [n.elementKey, n]));
  return args.graph.edges.map((edge) => {
    const loop = isLoopBack(edge, nodes);
    const colour = (edge.branch && BRANCH_COLOURS[edge.branch]) || DEFAULT_EDGE_COLOUR;
    const label = edgeDisplayLabel(edge);
    return {
      id: edge.elementKey,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      sourceHandle: loop ? LOOP_SOURCE_HANDLE : null,
      targetHandle: loop ? LOOP_TARGET_HANDLE : null,
      pathOptions: loop ? { offset: 28, borderRadius: 8 } : { borderRadius: 8 },
      label: label || undefined,
      selected: args.selection?.kind === 'edge' && args.selection.key === edge.elementKey,
      reconnectable: !args.readOnly,
      deletable: !args.readOnly,
      markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 18, height: 18 },
      style: { stroke: colour },
      labelStyle: { fill: colour, fontWeight: 600, fontSize: 11 },
      labelBgStyle: { fill: '#ffffff' },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
      data: { edge },
    };
  });
}
