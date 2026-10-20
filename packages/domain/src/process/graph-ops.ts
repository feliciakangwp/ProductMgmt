import { newKey } from '../ids';
import { NODE_TYPE_LABELS } from './types';
import type { EdgeBranch, Position, ProcessEdge, ProcessGraph, ProcessNode, ProcessNodeType } from './types';

/**
 * Pure editing operations on a process graph. Every function returns a new
 * graph and leaves the input untouched, so the editor can keep an undo
 * history of snapshots.
 */

export function createNode(type: ProcessNodeType, position: Position, label?: string): ProcessNode {
  return {
    elementKey: newKey(),
    refCode: null,
    type,
    label: label ?? (type === 'start' || type === 'end' ? NODE_TYPE_LABELS[type] : `New ${NODE_TYPE_LABELS[type].toLowerCase()}`),
    description: '',
    actorId: null,
    position,
    origin: 'manual',
    sourceText: null,
  };
}

export function addNode(graph: ProcessGraph, node: ProcessNode): ProcessGraph {
  return { ...graph, nodes: [...graph.nodes, node] };
}

/** Removes nodes and every connection touching them. */
export function removeNodes(graph: ProcessGraph, keys: string[]): ProcessGraph {
  const remove = new Set(keys);
  return {
    nodes: graph.nodes.filter((n) => !remove.has(n.elementKey)),
    edges: graph.edges.filter((e) => !remove.has(e.source) && !remove.has(e.target)),
  };
}

export function removeEdges(graph: ProcessGraph, keys: string[]): ProcessGraph {
  const remove = new Set(keys);
  return { ...graph, edges: graph.edges.filter((e) => !remove.has(e.elementKey)) };
}

export type NodePatch = Partial<Pick<ProcessNode, 'label' | 'description' | 'actorId' | 'type' | 'position'>>;

export function updateNode(graph: ProcessGraph, key: string, patch: NodePatch): ProcessGraph {
  let changed = false;
  const nodes = graph.nodes.map((n) => {
    if (n.elementKey !== key) return n;
    changed = true;
    return { ...n, ...patch };
  });
  return changed ? { ...graph, nodes } : graph;
}

export function moveNodes(graph: ProcessGraph, positions: Record<string, Position>): ProcessGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (positions[n.elementKey] ? { ...n, position: positions[n.elementKey]! } : n)),
  };
}

export type EdgePatch = Partial<Pick<ProcessEdge, 'label' | 'condition' | 'branch' | 'source' | 'target'>>;

export function updateEdge(graph: ProcessGraph, key: string, patch: EdgePatch): ProcessGraph {
  let changed = false;
  const edges = graph.edges.map((e) => {
    if (e.elementKey !== key) return e;
    changed = true;
    return { ...e, ...patch };
  });
  return changed ? { ...graph, edges } : graph;
}

export type ConnectResult = { ok: true; graph: ProcessGraph; edge: ProcessEdge } | { ok: false; reason: string };

/**
 * Connects two nodes. Rejects self-loops, duplicates and connections that
 * start from an end event or finish at a start event. When connecting from a
 * decision, the first two branches default to Yes and No.
 */
export function connectNodes(graph: ProcessGraph, source: string, target: string): ConnectResult {
  const from = graph.nodes.find((n) => n.elementKey === source);
  const to = graph.nodes.find((n) => n.elementKey === target);
  if (!from || !to) return { ok: false, reason: 'Both ends of a connection must be existing nodes.' };
  if (source === target) return { ok: false, reason: 'A node cannot connect to itself.' };
  if (from.type === 'end') return { ok: false, reason: 'An end event cannot have outgoing connections.' };
  if (to.type === 'start') return { ok: false, reason: 'A start event cannot have incoming connections.' };
  if (graph.edges.some((e) => e.source === source && e.target === target)) {
    return { ok: false, reason: 'These nodes are already connected.' };
  }

  let branch: EdgeBranch | null = null;
  if (from.type === 'decision' || from.type === 'approval') {
    const used = new Set(graph.edges.filter((e) => e.source === source).map((e) => e.branch));
    branch = !used.has('yes') ? 'yes' : !used.has('no') ? 'no' : 'other';
  }
  const edge: ProcessEdge = {
    elementKey: newKey(),
    source,
    target,
    label: branch === 'yes' ? 'Yes' : branch === 'no' ? 'No' : '',
    condition: '',
    branch,
  };
  return { ok: true, graph: { ...graph, edges: [...graph.edges, edge] }, edge };
}

/** Moves an existing connection to a new source and/or target, keeping its identity. */
export function reconnectEdge(graph: ProcessGraph, key: string, source: string, target: string): ConnectResult {
  const existing = graph.edges.find((e) => e.elementKey === key);
  if (!existing) return { ok: false, reason: 'Connection not found.' };
  const without = removeEdges(graph, [key]);
  const result = connectNodes(without, source, target);
  if (!result.ok) return result;
  const sameSource = existing.source === source;
  const edge: ProcessEdge = {
    ...existing,
    source,
    target,
    // A branch belongs to its decision; drop it if the source changed.
    branch: sameSource ? existing.branch : result.edge.branch,
    label: sameSource ? existing.label : result.edge.label,
  };
  return { ok: true, graph: { ...without, edges: [...without.edges, edge] }, edge };
}
