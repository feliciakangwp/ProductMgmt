import { ACTOR_REQUIRED_TYPES, NODE_TYPE_LABELS } from './types';
import type { Actor, ProcessEdge, ProcessFinding, ProcessGraph, ProcessNode } from './types';

export type IssueSeverity = 'error' | 'warning';

export type IssueCode =
  | 'MISSING_START'
  | 'MULTIPLE_START'
  | 'MISSING_END'
  | 'START_HAS_INCOMING'
  | 'END_HAS_OUTGOING'
  | 'DANGLING_EDGE'
  | 'SELF_LOOP'
  | 'DISCONNECTED_NODE'
  | 'UNREACHABLE_NODE'
  | 'NO_PATH_TO_END'
  | 'DEAD_END'
  | 'DECISION_TOO_FEW_BRANCHES'
  | 'APPROVAL_SINGLE_OUTCOME'
  | 'BRANCH_UNLABELLED'
  | 'DUPLICATE_BRANCH'
  | 'MISSING_ACTOR'
  | 'EMPTY_LABEL'
  | 'AMBIGUOUS_WORDING'
  | 'AMBIGUOUS_RULE'
  | 'OPEN_QUESTION';

export interface ValidationIssue {
  /** Stable id so the UI can track acknowledgement across re-validation. */
  id: string;
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  nodeKeys: string[];
  edgeKeys: string[];
  findingIds: string[];
}

export interface ValidationInput extends ProcessGraph {
  actors?: Actor[];
  findings?: ProcessFinding[];
}

/** Words and phrases that usually signal an under-specified rule or step. */
const VAGUE_TERMS = [
  'appropriate',
  'appropriately',
  'as needed',
  'as required',
  'if necessary',
  'where applicable',
  'where necessary',
  'sufficient',
  'reasonable',
  'timely',
  'promptly',
  'as soon as possible',
  'asap',
  'etc',
  'and so on',
  'some',
  'various',
  'several',
  'usually',
  'normally',
  'generally',
  'typically',
  'large amount',
  'small amount',
  'significant',
  'relevant',
  'tbd',
  'tbc',
  'to be confirmed',
  'to be determined',
  'and/or',
] as const;

const VAGUE_PATTERN = new RegExp(
  `(?<![\\w-])(${VAGUE_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})(?![\\w-])`,
  'gi',
);

/** Returns the distinct vague terms found in a piece of text, lower-cased. */
export function findVagueTerms(text: string): string[] {
  const matches = text.match(VAGUE_PATTERN) ?? [];
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}

function nodeName(node: ProcessNode): string {
  const label = node.label.trim() || `Unnamed ${NODE_TYPE_LABELS[node.type].toLowerCase()}`;
  return node.refCode ? `${node.refCode} "${label}"` : `"${label}"`;
}

function reach(start: string[], adjacency: Map<string, string[]>): Set<string> {
  const seen = new Set<string>(start);
  const queue = [...start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * Validates a process graph. Errors block approval; warnings are shown to
 * the analyst and must be acknowledged before approval.
 */
export function validateProcess(input: ValidationInput): ValidationIssue[] {
  const { nodes, edges, actors, findings = [] } = input;
  const issues: ValidationIssue[] = [];
  const add = (
    code: IssueCode,
    severity: IssueSeverity,
    message: string,
    refs: { nodeKeys?: string[]; edgeKeys?: string[]; findingIds?: string[] } = {},
  ) => {
    const nodeKeys = refs.nodeKeys ?? [];
    const edgeKeys = refs.edgeKeys ?? [];
    const findingIds = refs.findingIds ?? [];
    issues.push({
      id: [code, ...nodeKeys, ...edgeKeys, ...findingIds].join(':'),
      code,
      severity,
      message,
      nodeKeys,
      edgeKeys,
      findingIds,
    });
  };

  const nodeByKey = new Map(nodes.map((n) => [n.elementKey, n]));
  const validEdges: ProcessEdge[] = [];
  for (const edge of edges) {
    if (!nodeByKey.has(edge.source) || !nodeByKey.has(edge.target)) {
      add('DANGLING_EDGE', 'error', 'A connection points to an activity that no longer exists.', {
        edgeKeys: [edge.elementKey],
      });
      continue;
    }
    if (edge.source === edge.target) {
      add('SELF_LOOP', 'warning', `${nodeName(nodeByKey.get(edge.source)!)} connects to itself.`, {
        nodeKeys: [edge.source],
        edgeKeys: [edge.elementKey],
      });
    }
    validEdges.push(edge);
  }

  const outgoing = new Map<string, ProcessEdge[]>();
  const incoming = new Map<string, ProcessEdge[]>();
  for (const edge of validEdges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }

  // Start and end events
  const starts = nodes.filter((n) => n.type === 'start');
  const ends = nodes.filter((n) => n.type === 'end');
  if (nodes.length > 0 && starts.length === 0) {
    add('MISSING_START', 'error', 'The process has no start event.');
  }
  if (starts.length > 1) {
    add('MULTIPLE_START', 'error', `The process has ${starts.length} start events; use exactly one.`, {
      nodeKeys: starts.map((n) => n.elementKey),
    });
  }
  if (nodes.length > 0 && ends.length === 0) {
    add('MISSING_END', 'error', 'The process has no end event.');
  }
  for (const start of starts) {
    if ((incoming.get(start.elementKey) ?? []).length > 0) {
      add('START_HAS_INCOMING', 'warning', 'The start event has incoming connections.', {
        nodeKeys: [start.elementKey],
      });
    }
  }
  for (const end of ends) {
    if ((outgoing.get(end.elementKey) ?? []).length > 0) {
      add('END_HAS_OUTGOING', 'warning', `End event ${nodeName(end)} has outgoing connections.`, {
        nodeKeys: [end.elementKey],
      });
    }
  }

  // Connectivity
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const edge of validEdges) {
    forward.set(edge.source, [...(forward.get(edge.source) ?? []), edge.target]);
    backward.set(edge.target, [...(backward.get(edge.target) ?? []), edge.source]);
  }
  const reachable = starts.length > 0 ? reach(starts.map((n) => n.elementKey), forward) : null;
  const canFinish = ends.length > 0 ? reach(ends.map((n) => n.elementKey), backward) : null;

  for (const node of nodes) {
    const key = node.elementKey;
    const hasIn = (incoming.get(key) ?? []).length > 0;
    const hasOut = (outgoing.get(key) ?? []).length > 0;
    if (!hasIn && !hasOut && nodes.length > 1) {
      add('DISCONNECTED_NODE', 'error', `${nodeName(node)} is not connected to the process.`, {
        nodeKeys: [key],
      });
      continue;
    }
    if (reachable && !reachable.has(key)) {
      add('UNREACHABLE_NODE', 'error', `${nodeName(node)} cannot be reached from the start event.`, {
        nodeKeys: [key],
      });
    }
    if (node.type !== 'end' && !hasOut) {
      add('DEAD_END', 'warning', `${nodeName(node)} has no outgoing connection.`, { nodeKeys: [key] });
    } else if (canFinish && node.type !== 'end' && !canFinish.has(key)) {
      add('NO_PATH_TO_END', 'warning', `No path leads from ${nodeName(node)} to an end event.`, {
        nodeKeys: [key],
      });
    }
  }

  // Decisions and approvals
  for (const node of nodes) {
    if (node.type !== 'decision' && node.type !== 'approval') continue;
    const outs = outgoing.get(node.elementKey) ?? [];
    if (node.type === 'decision' && outs.length < 2) {
      add(
        'DECISION_TOO_FEW_BRANCHES',
        'error',
        `Decision ${nodeName(node)} has ${outs.length} outcome${outs.length === 1 ? '' : 's'}; a decision needs at least two.`,
        { nodeKeys: [node.elementKey] },
      );
    }
    if (node.type === 'approval' && outs.length === 1) {
      add(
        'APPROVAL_SINGLE_OUTCOME',
        'warning',
        `Approval ${nodeName(node)} has only one outcome. Is there a rejection path?`,
        { nodeKeys: [node.elementKey] },
      );
    }
    if (outs.length >= 2) {
      for (const edge of outs) {
        if (!edge.branch && !edge.label.trim() && !edge.condition.trim()) {
          add('BRANCH_UNLABELLED', 'warning', `An outcome of ${nodeName(node)} has no label or condition.`, {
            nodeKeys: [node.elementKey],
            edgeKeys: [edge.elementKey],
          });
        }
      }
      for (const branch of ['yes', 'no'] as const) {
        const same = outs.filter((e) => e.branch === branch);
        if (same.length > 1) {
          add(
            'DUPLICATE_BRANCH',
            'warning',
            `${nodeName(node)} has ${same.length} "${branch === 'yes' ? 'Yes' : 'No'}" branches.`,
            { nodeKeys: [node.elementKey], edgeKeys: same.map((e) => e.elementKey) },
          );
        }
      }
    }
  }

  // Labels, actors and wording
  const actorIds = actors ? new Set(actors.map((a) => a.id)) : null;
  for (const node of nodes) {
    if (!node.label.trim() && node.type !== 'start' && node.type !== 'end') {
      add('EMPTY_LABEL', 'warning', `A ${NODE_TYPE_LABELS[node.type].toLowerCase()} has no name.`, {
        nodeKeys: [node.elementKey],
      });
    }
    if (ACTOR_REQUIRED_TYPES.includes(node.type)) {
      const missing = !node.actorId || (actorIds !== null && !actorIds.has(node.actorId));
      if (missing) {
        add('MISSING_ACTOR', 'warning', `${nodeName(node)} has no responsible actor.`, {
          nodeKeys: [node.elementKey],
        });
      }
    }
    const vague = findVagueTerms(`${node.label} ${node.description}`);
    if (vague.length > 0) {
      add(
        'AMBIGUOUS_WORDING',
        'warning',
        `${nodeName(node)} uses vague wording (${vague.map((t) => `"${t}"`).join(', ')}). Make it specific.`,
        { nodeKeys: [node.elementKey] },
      );
    }
  }
  for (const edge of validEdges) {
    const vague = findVagueTerms(`${edge.label} ${edge.condition}`);
    if (vague.length > 0) {
      add(
        'AMBIGUOUS_WORDING',
        'warning',
        `A condition uses vague wording (${vague.map((t) => `"${t}"`).join(', ')}).`,
        { nodeKeys: [edge.source], edgeKeys: [edge.elementKey] },
      );
    }
  }

  // Findings
  for (const finding of findings) {
    if (finding.status === 'dismissed') continue;
    const related = finding.relatedNodeKeys.filter((k) => nodeByKey.has(k));
    if (finding.kind === 'business_rule') {
      const vague = findVagueTerms(finding.statement);
      if (vague.length > 0) {
        add(
          'AMBIGUOUS_RULE',
          'warning',
          `Business rule "${finding.statement}" is ambiguous (${vague.map((t) => `"${t}"`).join(', ')}).`,
          { nodeKeys: related, findingIds: [finding.elementKey] },
        );
      }
    } else if (finding.status === 'draft' && (finding.kind === 'missing_information' || finding.kind === 'ambiguity')) {
      add('OPEN_QUESTION', 'warning', finding.statement, { nodeKeys: related, findingIds: [finding.elementKey] });
    }
  }

  return issues;
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
