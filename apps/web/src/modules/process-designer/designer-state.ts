import type { ProcessFinding, ProcessGraph } from '@productflow/domain';

/**
 * Editor state for one process version. The graph is the single source of
 * truth; React Flow renders a projection of it (see flow-mapping.ts).
 */

export type Selection = { kind: 'node'; key: string } | { kind: 'edge'; key: string } | null;

interface Snapshot {
  graph: ProcessGraph;
  findings: ProcessFinding[];
}

export interface DesignerState {
  versionId: string | null;
  revision: number;
  description: string;
  graph: ProcessGraph;
  findings: ProcessFinding[];
  /** Analysis run whose proposal was accepted since the last save. */
  analysisRunId: string | null;
  dirty: boolean;
  selection: Selection;
  past: Snapshot[];
  future: Snapshot[];
  /** Groups consecutive edits (e.g. typing in one field) into a single undo step. */
  historyGroup: string | null;
}

export const HISTORY_LIMIT = 100;

export const initialDesignerState: DesignerState = {
  versionId: null,
  revision: 0,
  description: '',
  graph: { nodes: [], edges: [] },
  findings: [],
  analysisRunId: null,
  dirty: false,
  selection: null,
  past: [],
  future: [],
  historyGroup: null,
};

export type DesignerAction =
  | {
      type: 'load';
      versionId: string;
      revision: number;
      description: string;
      graph: ProcessGraph;
      findings: ProcessFinding[];
    }
  | { type: 'restore'; description: string; graph: ProcessGraph; findings: ProcessFinding[] }
  | { type: 'setDescription'; description: string }
  /**
   * Applies a graph change. `history: 'push'` records an undo step,
   * `'group:<id>'` merges with the previous step of the same group, and
   * `'none'` is for continuous updates (dragging) after a `checkpoint`.
   */
  | { type: 'updateGraph'; update: (graph: ProcessGraph) => ProcessGraph; history?: 'push' | 'none' | `group:${string}` }
  | { type: 'updateFindings'; update: (findings: ProcessFinding[]) => ProcessFinding[]; history?: 'push' | `group:${string}` }
  | { type: 'checkpoint' }
  | { type: 'acceptProposal'; graph: ProcessGraph; findings: ProcessFinding[]; analysisRunId: string }
  | { type: 'select'; selection: Selection }
  | { type: 'undo' }
  | { type: 'redo' }
  /** Fills in ref codes assigned by the database. Not an edit: no history, no dirty flag. */
  | { type: 'applyRefCodes'; refCodes: Record<string, string | null> }
  /** The save carried these exact values; edits made while it was in flight stay dirty. */
  | {
      type: 'saved';
      revision: number;
      description: string;
      graph: ProcessGraph;
      findings: ProcessFinding[];
      analysisRunId: string | null;
    };

function snapshot(state: DesignerState): Snapshot {
  return { graph: state.graph, findings: state.findings };
}

function pushHistory(state: DesignerState, group: string | null): Pick<DesignerState, 'past' | 'future' | 'historyGroup'> {
  if (group !== null && group === state.historyGroup) {
    return { past: state.past, future: [], historyGroup: group };
  }
  return { past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT), future: [], historyGroup: group };
}

/** Drops a selection that no longer points at anything. */
function validSelection(selection: Selection, graph: ProcessGraph): Selection {
  if (!selection) return null;
  if (selection.kind === 'node') return graph.nodes.some((n) => n.elementKey === selection.key) ? selection : null;
  return graph.edges.some((e) => e.elementKey === selection.key) ? selection : null;
}

export function designerReducer(state: DesignerState, action: DesignerAction): DesignerState {
  switch (action.type) {
    case 'load':
      return {
        ...initialDesignerState,
        versionId: action.versionId,
        revision: action.revision,
        description: action.description,
        graph: action.graph,
        findings: action.findings,
      };

    case 'restore':
      return {
        ...state,
        ...pushHistory(state, null),
        description: action.description,
        graph: action.graph,
        findings: action.findings,
        dirty: true,
        selection: null,
      };

    case 'setDescription':
      if (action.description === state.description) return state;
      return { ...state, description: action.description, dirty: true };

    case 'updateGraph': {
      const graph = action.update(state.graph);
      if (graph === state.graph) return state;
      const mode = action.history ?? 'push';
      const history =
        mode === 'none'
          ? { past: state.past, future: [], historyGroup: state.historyGroup }
          : pushHistory(state, mode === 'push' ? null : mode);
      return { ...state, ...history, graph, dirty: true, selection: validSelection(state.selection, graph) };
    }

    case 'updateFindings': {
      const findings = action.update(state.findings);
      if (findings === state.findings) return state;
      const mode = action.history ?? 'push';
      return { ...state, ...pushHistory(state, mode === 'push' ? null : mode), findings, dirty: true };
    }

    case 'checkpoint':
      return { ...state, ...pushHistory(state, null) };

    case 'acceptProposal': {
      // Keep findings the analyst wrote or already decided on; replace AI drafts.
      const kept = state.findings.filter((f) => f.origin === 'manual' || f.status !== 'draft');
      return {
        ...state,
        ...pushHistory(state, null),
        graph: action.graph,
        findings: [...kept, ...action.findings],
        analysisRunId: action.analysisRunId,
        dirty: true,
        selection: null,
      };
    }

    case 'select':
      return { ...state, selection: action.selection, historyGroup: null };

    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future],
        graph: previous.graph,
        findings: previous.findings,
        dirty: true,
        historyGroup: null,
        selection: validSelection(state.selection, previous.graph),
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        past: [...state.past, snapshot(state)],
        future: state.future.slice(1),
        graph: next.graph,
        findings: next.findings,
        dirty: true,
        historyGroup: null,
        selection: validSelection(state.selection, next.graph),
      };
    }

    case 'applyRefCodes': {
      const patch = (graph: ProcessGraph): ProcessGraph => {
        if (!graph.nodes.some((n) => !n.refCode && action.refCodes[n.elementKey])) return graph;
        return {
          ...graph,
          nodes: graph.nodes.map((n) => (n.refCode ? n : { ...n, refCode: action.refCodes[n.elementKey] ?? null })),
        };
      };
      const graph = patch(state.graph);
      // Keep the saved-state comparison intact: a save that matched before still matches.
      return {
        ...state,
        graph,
        past: state.past.map((s) => ({ ...s, graph: patch(s.graph) })),
        future: state.future.map((s) => ({ ...s, graph: patch(s.graph) })),
      };
    }

    case 'saved': {
      const unchanged =
        state.graph === action.graph && state.findings === action.findings && state.description === action.description;
      return {
        ...state,
        revision: action.revision,
        dirty: !unchanged,
        analysisRunId: state.analysisRunId === action.analysisRunId ? null : state.analysisRunId,
      };
    }
  }
}
