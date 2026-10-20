import { describe, expect, it } from 'vitest';
import {
  createNode,
  findVagueTerms,
  hasBlockingIssues,
  validateProcess,
  type IssueCode,
  type ProcessEdge,
  type ProcessGraph,
  type ProcessNode,
  type ProcessNodeType,
} from '../index';

let seq = 0;
function node(type: ProcessNodeType, label?: string, actorId: string | null = 'actor'): ProcessNode {
  const n = createNode(type, { x: 0, y: 0 }, label);
  return { ...n, elementKey: `${type}-${++seq}`, actorId };
}
function edge(source: ProcessNode, target: ProcessNode, extra: Partial<ProcessEdge> = {}): ProcessEdge {
  return {
    elementKey: `e-${++seq}`,
    source: source.elementKey,
    target: target.elementKey,
    label: '',
    condition: '',
    branch: null,
    ...extra,
  };
}
const codes = (graph: ProcessGraph, extra = {}) => validateProcess({ ...graph, ...extra }).map((i) => i.code);

function linear(): { graph: ProcessGraph; start: ProcessNode; task: ProcessNode; end: ProcessNode } {
  const start = node('start');
  const task = node('activity', 'Retrieve debt record');
  const end = node('end');
  return { graph: { nodes: [start, task, end], edges: [edge(start, task), edge(task, end)] }, start, task, end };
}

describe('validateProcess', () => {
  it('returns no issues for a valid linear process', () => {
    expect(validateProcess(linear().graph)).toEqual([]);
  });

  it('returns no issues for an empty process', () => {
    expect(validateProcess({ nodes: [], edges: [] })).toEqual([]);
  });

  it('reports missing start and end events as errors', () => {
    const task = node('activity', 'Do work');
    const issues = validateProcess({ nodes: [task], edges: [] });
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining<IssueCode>(['MISSING_START', 'MISSING_END']));
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it('reports multiple start events', () => {
    const { graph, task } = linear();
    const second = node('start');
    graph.nodes.push(second);
    graph.edges.push(edge(second, task));
    expect(codes(graph)).toContain('MULTIPLE_START');
  });

  it('reports disconnected activities', () => {
    const { graph } = linear();
    const orphan = node('activity', 'Archive file');
    graph.nodes.push(orphan);
    const issues = validateProcess(graph);
    const disconnected = issues.find((i) => i.code === 'DISCONNECTED_NODE');
    expect(disconnected?.nodeKeys).toEqual([orphan.elementKey]);
    expect(disconnected?.severity).toBe('error');
  });

  it('reports activities unreachable from the start', () => {
    const { graph, end } = linear();
    const a = node('activity', 'Island A');
    const b = node('activity', 'Island B');
    graph.nodes.push(a, b);
    graph.edges.push(edge(a, b), edge(b, end));
    const issues = validateProcess(graph).filter((i) => i.code === 'UNREACHABLE_NODE');
    expect(issues.map((i) => i.nodeKeys[0])).toEqual([a.elementKey, b.elementKey]);
  });

  it('warns about dead ends and loops with no way out', () => {
    const { graph, task } = linear();
    const stuck = node('activity', 'Wait');
    graph.nodes.push(stuck);
    graph.edges.push(edge(task, stuck));
    const loopA = node('activity', 'Loop A');
    const loopB = node('activity', 'Loop B');
    graph.nodes.push(loopA, loopB);
    graph.edges.push(edge(task, loopA), edge(loopA, loopB), edge(loopB, loopA));
    const issues = validateProcess(graph);
    expect(issues.find((i) => i.code === 'DEAD_END')?.nodeKeys).toEqual([stuck.elementKey]);
    expect(issues.filter((i) => i.code === 'NO_PATH_TO_END').map((i) => i.nodeKeys[0])).toEqual([
      loopA.elementKey,
      loopB.elementKey,
    ]);
  });

  it('reports decisions with fewer than two outcomes', () => {
    const start = node('start');
    const decision = node('decision', 'Eligible?');
    const end = node('end');
    const graph = { nodes: [start, decision, end], edges: [edge(start, decision), edge(decision, end)] };
    const issue = validateProcess(graph).find((i) => i.code === 'DECISION_TOO_FEW_BRANCHES');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toContain('1 outcome;');
  });

  it('warns about unlabelled and duplicate decision branches', () => {
    const start = node('start');
    const decision = node('decision', 'Eligible?');
    const a = node('end', 'A');
    const b = node('end', 'B');
    const c = node('end', 'C');
    const graph = {
      nodes: [start, decision, a, b, c],
      edges: [
        edge(start, decision),
        edge(decision, a, { branch: 'yes', label: 'Yes' }),
        edge(decision, b, { branch: 'yes', label: 'Yes' }),
        edge(decision, c),
      ],
    };
    expect(codes(graph)).toEqual(expect.arrayContaining<IssueCode>(['BRANCH_UNLABELLED', 'DUPLICATE_BRANCH']));
  });

  it('warns when an approval has no rejection path', () => {
    const start = node('start');
    const approval = node('approval', 'Supervisor review');
    const end = node('end');
    const graph = { nodes: [start, approval, end], edges: [edge(start, approval), edge(approval, end)] };
    expect(codes(graph)).toContain('APPROVAL_SINGLE_OUTCOME');
    expect(hasBlockingIssues(validateProcess(graph))).toBe(false);
  });

  it('warns about missing responsible actors, including deleted actors', () => {
    const { graph, task } = linear();
    task.actorId = null;
    expect(codes(graph)).toContain('MISSING_ACTOR');
    task.actorId = 'deleted-actor';
    expect(codes(graph, { actors: [{ id: 'actor', name: 'Officer', kind: 'role' }] })).toContain('MISSING_ACTOR');
    // Start, end and system activities do not need a human actor.
    expect(
      validateProcess({ ...graph, nodes: graph.nodes.filter((n) => n !== task) }).some((i) => i.code === 'MISSING_ACTOR'),
    ).toBe(false);
  });

  it('reports connections to deleted nodes', () => {
    const { graph, task } = linear();
    graph.edges.push({ ...edge(task, task), target: 'ghost' });
    expect(codes(graph)).toContain('DANGLING_EDGE');
  });

  it('flags vague wording in activities, conditions and business rules', () => {
    const { graph, task } = linear();
    task.description = 'Officer takes appropriate action as soon as possible.';
    const issues = validateProcess({
      ...graph,
      findings: [
        {
          elementKey: 'f1',
          kind: 'business_rule',
          statement: 'Large amount requests need sufficient evidence.',
          sourceText: null,
          origin: 'stated',
          status: 'draft',
          relatedNodeKeys: [task.elementKey],
        },
      ],
    });
    const wording = issues.find((i) => i.code === 'AMBIGUOUS_WORDING');
    expect(wording?.message).toContain('"appropriate", "as soon as possible"');
    const rule = issues.find((i) => i.code === 'AMBIGUOUS_RULE');
    expect(rule?.findingIds).toEqual(['f1']);
    expect(rule?.nodeKeys).toEqual([task.elementKey]);
  });

  it('surfaces open questions until they are resolved', () => {
    const { graph } = linear();
    const finding = {
      elementKey: 'q1',
      kind: 'missing_information' as const,
      statement: 'Who approves amounts over $10,000?',
      sourceText: null,
      origin: 'inferred' as const,
      status: 'draft' as const,
      relatedNodeKeys: [],
    };
    expect(codes(graph, { findings: [finding] })).toContain('OPEN_QUESTION');
    expect(codes(graph, { findings: [{ ...finding, status: 'accepted' }] })).not.toContain('OPEN_QUESTION');
    expect(codes(graph, { findings: [{ ...finding, status: 'dismissed' }] })).not.toContain('OPEN_QUESTION');
  });

  it('gives issues stable ids', () => {
    const task = node('activity', 'Do work');
    const a = validateProcess({ nodes: [task], edges: [] }).map((i) => i.id);
    const b = validateProcess({ nodes: [task], edges: [] }).map((i) => i.id);
    expect(a).toEqual(b);
  });
});

describe('findVagueTerms', () => {
  it('matches whole words and phrases only', () => {
    expect(findVagueTerms('Handsome awesome etcetera')).toEqual([]);
    expect(findVagueTerms('Use some judgement, etc.')).toEqual(['some', 'etc']);
    expect(findVagueTerms('Approve if necessary and/or escalate')).toEqual(['if necessary', 'and/or']);
  });
});
