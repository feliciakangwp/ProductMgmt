import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import {
  addNode,
  connectNodes,
  createNode,
  layoutGraph,
  moveNodes,
  NODE_DIMENSIONS,
  NODE_TYPE_LABELS,
  reconnectEdge,
  removeEdges,
  removeNodes,
  type Actor,
  type Position,
  type ProcessGraph,
  type ProcessNodeType,
  type ValidationIssue,
} from '@productflow/domain';
import { clsx } from 'clsx';
import { Circle, CheckCircle2, Cpu, Diamond, LayoutDashboard, Square, StopCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type DragEvent } from 'react';
import type { DesignerAction, Selection } from './designer-state';
import { toFlowEdges, toFlowNodes, type ProcessFlowEdge, type ProcessFlowNode } from './flow-mapping';
import { nodeTypes } from './nodes';

const PALETTE: { type: ProcessNodeType; icon: typeof Square }[] = [
  { type: 'start', icon: Circle },
  { type: 'activity', icon: Square },
  { type: 'decision', icon: Diamond },
  { type: 'approval', icon: CheckCircle2 },
  { type: 'system', icon: Cpu },
  { type: 'end', icon: StopCircle },
];

const DRAG_MIME = 'application/x-productflow-node';

export function ProcessCanvas({
  graph,
  actors,
  issues,
  selection,
  readOnly,
  dispatch,
  fitSignal,
}: {
  graph: ProcessGraph;
  actors: Actor[];
  issues: ValidationIssue[];
  selection: Selection;
  readOnly: boolean;
  dispatch: Dispatch<DesignerAction>;
  /** Changing this value fits the view to the graph. */
  fitSignal: number;
}) {
  const flow = useReactFlow<ProcessFlowNode, ProcessFlowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const nodes = useMemo(
    () => toFlowNodes({ graph, actors, issues, selection, readOnly }),
    [graph, actors, issues, selection, readOnly],
  );
  const edges = useMemo(() => toFlowEdges({ graph, selection, readOnly }), [graph, selection, readOnly]);

  useEffect(() => {
    const id = requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 250, maxZoom: 1.2, minZoom: 0.55 }));
    return () => cancelAnimationFrame(id);
  }, [fitSignal, flow]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  const onNodesChange = useCallback(
    (changes: NodeChange<ProcessFlowNode>[]) => {
      if (readOnly) return;
      const positions: Record<string, Position> = {};
      const removed: string[] = [];
      for (const change of changes) {
        if (change.type === 'position' && change.position) positions[change.id] = change.position;
        if (change.type === 'remove') removed.push(change.id);
      }
      if (Object.keys(positions).length > 0) {
        dispatch({ type: 'updateGraph', update: (g) => moveNodes(g, positions), history: 'none' });
      }
      if (removed.length > 0) {
        dispatch({ type: 'updateGraph', update: (g) => removeNodes(g, removed) });
      }
    },
    [dispatch, readOnly],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<ProcessFlowEdge>[]) => {
      if (readOnly) return;
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removed.length > 0) dispatch({ type: 'updateGraph', update: (g) => removeEdges(g, removed) });
    },
    [dispatch, readOnly],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const result = connectNodes(graph, connection.source, connection.target);
      if (!result.ok) {
        setNotice(result.reason);
        return;
      }
      dispatch({ type: 'updateGraph', update: () => result.graph });
      dispatch({ type: 'select', selection: { kind: 'edge', key: result.edge.elementKey } });
    },
    [dispatch, graph],
  );

  const onReconnect = useCallback(
    (oldEdge: ProcessFlowEdge, connection: Connection) => {
      const result = reconnectEdge(graph, oldEdge.id, connection.source, connection.target);
      if (!result.ok) {
        setNotice(result.reason);
        return;
      }
      dispatch({ type: 'updateGraph', update: () => result.graph });
    },
    [dispatch, graph],
  );

  const add = useCallback(
    (type: ProcessNodeType, center?: Position) => {
      let position = center;
      if (!position) {
        const rect = wrapper.current?.getBoundingClientRect();
        position = flow.screenToFlowPosition({
          x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2,
          y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
        });
      }
      const size = NODE_DIMENSIONS[type];
      const node = createNode(type, { x: Math.round(position.x - size.width / 2), y: Math.round(position.y - size.height / 2) });
      dispatch({ type: 'updateGraph', update: (g) => addNode(g, node) });
      dispatch({ type: 'select', selection: { kind: 'node', key: node.elementKey } });
    },
    [dispatch, flow],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      const type = event.dataTransfer.getData(DRAG_MIME) as ProcessNodeType;
      if (!type || readOnly) return;
      event.preventDefault();
      add(type, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [add, flow, readOnly],
  );

  const autoLayout = () => {
    dispatch({ type: 'updateGraph', update: (g) => ({ ...g, nodes: layoutGraph(g.nodes, g.edges) }) });
    requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 300, maxZoom: 1.2, minZoom: 0.55 }));
  };

  return (
    <div className="flex size-full flex-col">
      <div className="flex h-11 shrink-0 items-center border-b border-slate-200 bg-white px-2">
        <div className="flex items-center gap-0.5">
          {readOnly ? null : (
            <>
              <span className="px-1.5 text-[11px] font-medium text-slate-400">Add</span>
              {PALETTE.map(({ type, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, type);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => add(type)}
                  title={`Add ${NODE_TYPE_LABELS[type].toLowerCase()} (click or drag onto the map)`}
                  aria-label={NODE_TYPE_LABELS[type].replace(' Activity', '')}
                  className="flex size-8 items-center justify-center rounded text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <Icon className="size-4" />
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            </>
          )}
          <button
            type="button"
            onClick={autoLayout}
            disabled={readOnly || graph.nodes.length === 0}
            title="Arrange the map automatically"
            className={clsx(
              'flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium',
              readOnly || graph.nodes.length === 0 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )}
          >
            <LayoutDashboard className="size-3.5" /> Auto layout
          </button>
        </div>
      </div>
      <div ref={wrapper} className="relative min-h-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <ReactFlow<ProcessFlowNode, ProcessFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onNodeDragStart={() => dispatch({ type: 'checkpoint' })}
          onNodeClick={(_, node) => dispatch({ type: 'select', selection: { kind: 'node', key: node.id } })}
          onEdgeClick={(_, edge) => dispatch({ type: 'select', selection: { kind: 'edge', key: edge.id } })}
          onPaneClick={() => dispatch({ type: 'select', selection: null })}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          edgesReconnectable={!readOnly}
          elementsSelectable
          deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
          multiSelectionKeyCode={null}
          selectionKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1.2, minZoom: 0.55 }}
          minZoom={0.2}
          maxZoom={2}
          snapToGrid
          snapGrid={[8, 8]}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#cbd5e1" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            className="!h-24 !w-36"
            nodeColor="#93c5fd"
            maskColor="rgba(241,245,249,0.7)"
          />
          {notice ? (
            <Panel position="top-center">
              <div role="status" className="rounded-md bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
                {notice}
              </div>
            </Panel>
          ) : null}
        </ReactFlow>
        {graph.nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="max-w-sm rounded-lg border border-dashed border-slate-300 bg-white/80 px-6 py-5 text-center text-sm text-slate-500">
              {readOnly
                ? 'This version has no process map.'
                : 'Describe the process on the left and click "Analyse & Generate Process Map", or add steps from the toolbar.'}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
