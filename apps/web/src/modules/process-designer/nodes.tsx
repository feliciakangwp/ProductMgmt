import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react';
import { clsx } from 'clsx';
import { CheckCircle2, Cpu, Sparkles, User } from 'lucide-react';
import { memo } from 'react';
import type { ProcessFlowNode } from './flow-mapping';

function ringClass(selected: boolean, severity: ProcessFlowNode['data']['severity']) {
  if (selected) return 'ring-2 ring-brand-600 ring-offset-2';
  if (severity === 'error') return 'ring-2 ring-red-500';
  if (severity === 'warning') return 'ring-2 ring-amber-400';
  return '';
}

/** Ids of the side handles used to route rework loops (see flow-mapping.ts). */
export const LOOP_SOURCE_HANDLE = 'loop-out';
export const LOOP_TARGET_HANDLE = 'loop-in';

function Handles({ readOnly }: { readOnly: boolean }) {
  const cls = clsx(readOnly && '!opacity-0');
  return (
    <>
      <Handle type="target" position={Position.Top} className={cls} />
      <Handle type="source" position={Position.Bottom} className={cls} />
      {/* Invisible anchors on the right so loops back to earlier steps run beside the main flow. */}
      <Handle
        id={LOOP_SOURCE_HANDLE}
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!top-[65%] !opacity-0"
      />
      <Handle
        id={LOOP_TARGET_HANDLE}
        type="target"
        position={Position.Right}
        isConnectable={false}
        className="!top-[35%] !opacity-0"
      />
    </>
  );
}

function InferredMark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span title="Inferred by AI: not stated in the description. Review before approval." className="text-violet-500">
      <Sparkles className="size-3" aria-label="Inferred by AI" />
    </span>
  );
}

const EventNode = memo(function EventNode({ data, selected, type }: NodeProps<ProcessFlowNode>) {
  const isStart = type === 'start';
  return (
    <div className="relative size-full">
      <div
        className={clsx(
          'flex size-full items-center justify-center rounded-full bg-white shadow-sm',
          isStart ? 'border-2 border-emerald-500' : 'border-4 border-slate-700',
          ringClass(selected, data.severity),
        )}
      >
        <span className={clsx('size-3 rounded-full', isStart ? 'bg-emerald-500' : 'bg-slate-700')} />
      </div>
      <div
        className={clsx(
          'absolute left-1/2 w-40 -translate-x-1/2 text-center text-[11px] leading-tight font-medium text-slate-700',
          // Start events have no incoming line above them; end events no outgoing line below.
          isStart ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {data.node.label}
      </div>
      {isStart ? null : <Handle type="target" position={Position.Top} className={clsx(data.readOnly && '!opacity-0')} />}
      {isStart ? null : (
        <Handle id={LOOP_TARGET_HANDLE} type="target" position={Position.Right} isConnectable={false} className="!opacity-0" />
      )}
      {isStart ? <Handle type="source" position={Position.Bottom} className={clsx(data.readOnly && '!opacity-0')} /> : null}
    </div>
  );
});

const TASK_STYLES = {
  activity: { accent: 'border-l-brand-600', icon: null, tag: null },
  approval: { accent: 'border-l-amber-500', icon: <CheckCircle2 className="size-3.5 text-amber-600" />, tag: 'Approval' },
  system: { accent: 'border-l-indigo-500', icon: <Cpu className="size-3.5 text-indigo-600" />, tag: 'System' },
} as const;

const TaskNode = memo(function TaskNode({ data, selected, type }: NodeProps<ProcessFlowNode>) {
  const style = TASK_STYLES[type as keyof typeof TASK_STYLES] ?? TASK_STYLES.activity;
  const { node, actorName } = data;
  return (
    <div
      className={clsx(
        'flex size-full flex-col justify-between rounded-md border border-l-4 border-slate-200 bg-white px-2.5 py-1.5 shadow-sm',
        type === 'system' && 'bg-indigo-50/40',
        style.accent,
        ringClass(selected, data.severity),
      )}
    >
      <div className="flex items-center gap-1 text-[10px] text-slate-400">
        {style.icon}
        <span className="font-mono">{node.refCode ?? 'new'}</span>
        {style.tag ? <span className="font-medium text-slate-500">· {style.tag}</span> : null}
        <span className="ml-auto">
          <InferredMark show={node.origin === 'inferred'} />
        </span>
      </div>
      <p className="line-clamp-2 text-xs leading-snug font-medium text-slate-800">
        {node.label || <em className="text-slate-400">Unnamed</em>}
      </p>
      <div className="flex items-center gap-1 truncate text-[10px]">
        {type === 'system' && !actorName ? null : (
          <>
            <User className={clsx('size-3 shrink-0', actorName ? 'text-slate-400' : 'text-amber-500')} />
            <span className={clsx('truncate', actorName ? 'text-slate-500' : 'text-amber-600')}>{actorName ?? 'No actor'}</span>
          </>
        )}
      </div>
      <Handles readOnly={data.readOnly} />
    </div>
  );
});

const DecisionNode = memo(function DecisionNode({ data, selected }: NodeProps<ProcessFlowNode>) {
  const { node, actorName } = data;
  return (
    <div className="relative size-full">
      <div
        className={clsx(
          'absolute inset-[15%] rotate-45 rounded-md border-2 border-sky-500 bg-sky-50 shadow-sm',
          ringClass(selected, data.severity),
        )}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <span className="font-mono text-[9px] text-slate-400">{node.refCode ?? 'new'}</span>
        <p className="line-clamp-3 text-[11px] leading-tight font-medium text-slate-800">
          {node.label || <em className="text-slate-400">Unnamed</em>}
        </p>
        <span className={clsx('mt-0.5 max-w-full truncate text-[9px]', actorName ? 'text-slate-500' : 'text-amber-600')}>
          {actorName ?? 'No actor'}
        </span>
        <InferredMark show={node.origin === 'inferred'} />
      </div>
      <Handles readOnly={data.readOnly} />
    </div>
  );
});

export const nodeTypes: NodeTypes = {
  start: EventNode,
  end: EventNode,
  activity: TaskNode,
  approval: TaskNode,
  system: TaskNode,
  decision: DecisionNode,
};
