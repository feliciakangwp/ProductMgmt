import { describe, expect, it } from 'vitest';
import {
  analysisToProposal,
  parseProcessAnalysis,
  processAnalysisJsonSchema,
  resolveProposalActors,
  validateProcess,
  type ProcessAnalysis,
} from '../index';
import { DEBT_WRITE_OFF_ANALYSIS } from '../testing/fixtures';

const clone = (): ProcessAnalysis => structuredClone(DEBT_WRITE_OFF_ANALYSIS);

describe('processAnalysisJsonSchema', () => {
  it('produces a structured-output compatible schema', () => {
    const schema = processAnalysisJsonSchema();
    expect(schema.$schema).toBeUndefined();
    expect(schema.type).toBe('object');

    // Every object must forbid additional properties and list all keys as required.
    const visit = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.type === 'object') {
        expect(obj.additionalProperties, path).toBe(false);
        expect(Object.keys(obj.properties as object).sort(), path).toEqual([...(obj.required as string[])].sort());
      }
      expect(Array.isArray(obj.type), `${path}.type`).toBe(false);
      for (const unsupported of ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'minItems']) {
        expect(obj[unsupported], `${path}.${unsupported}`).toBeUndefined();
      }
      for (const [k, v] of Object.entries(obj)) visit(v, `${path}.${k}`);
    };
    visit(schema, '$');
  });
});

describe('parseProcessAnalysis', () => {
  it('accepts a valid response', () => {
    const result = parseProcessAnalysis(JSON.stringify(DEBT_WRITE_OFF_ANALYSIS));
    expect(result.ok).toBe(true);
  });

  it('rejects text that is not JSON', () => {
    const result = parseProcessAnalysis('Here is your process map: {');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/not valid JSON/);
  });

  it('rejects schema violations with a readable path', () => {
    const bad = clone() as unknown as { steps: Array<Record<string, unknown>> };
    bad.steps[1]!.type = 'subprocess';
    const result = parseProcessAnalysis(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith('steps.1.type'))).toBe(true);
  });

  it('rejects unexpected properties', () => {
    const bad = { ...clone(), confidence: 0.9 };
    expect(parseProcessAnalysis(JSON.stringify(bad)).ok).toBe(false);
  });

  it('rejects flows and findings that reference unknown steps', () => {
    const bad = clone();
    bad.flows.push({ from: 'S6', to: 'S99', branch: null, label: '', condition: '' });
    bad.findings[0]!.relatedStepIds.push('S42');
    const result = parseProcessAnalysis(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('flows.8.to: unknown step id "S99"');
      expect(result.errors).toContain('findings.0.relatedStepIds: unknown step id "S42"');
    }
  });

  it('rejects duplicate step ids', () => {
    const bad = clone();
    bad.steps[2]!.id = 'S2';
    const result = parseProcessAnalysis(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });
});

describe('analysisToProposal', () => {
  it('maps steps and flows to nodes and edges with fresh lineage keys', () => {
    const proposal = analysisToProposal(DEBT_WRITE_OFF_ANALYSIS);
    expect(proposal.nodes).toHaveLength(8);
    expect(proposal.edges).toHaveLength(8);
    const keys = new Set(proposal.nodes.map((n) => n.elementKey));
    expect(keys.size).toBe(8);
    for (const edge of proposal.edges) {
      expect(keys.has(edge.source)).toBe(true);
      expect(keys.has(edge.target)).toBe(true);
    }
    expect(proposal.nodes.every((n) => n.refCode === null)).toBe(true);
  });

  it('keeps origin and source text so inferred steps stay visible', () => {
    const proposal = analysisToProposal(DEBT_WRITE_OFF_ANALYSIS);
    const inferred = proposal.nodes.filter((n) => n.origin === 'inferred');
    expect(inferred.map((n) => n.label)).toEqual(['Debt written off', 'Request not eligible']);
    expect(proposal.nodes[1]!.sourceText).toBe('the officer retrieves the debt record');
  });

  it('labels yes/no branches when the model left labels empty', () => {
    const proposal = analysisToProposal(DEBT_WRITE_OFF_ANALYSIS);
    const no = proposal.edges.find((e) => e.branch === 'no' && e.condition.includes('<= 5'));
    expect(no?.label).toBe('No');
  });

  it('adds actors referenced by steps but missing from the actor list', () => {
    const analysis = clone();
    analysis.actors = analysis.actors.filter((a) => a.name !== 'Supervisor');
    analysis.steps[3]!.actor = '  finance officer ';
    const proposal = analysisToProposal(analysis);
    expect(proposal.actors.map((a) => a.name)).toEqual(['Finance Officer', 'Debt Management System', 'Supervisor']);
    expect(proposal.nodes[3]!.actorName).toBe('Finance Officer');
  });

  it('maps finding step references to node keys', () => {
    const proposal = analysisToProposal(DEBT_WRITE_OFF_ANALYSIS);
    const decision = proposal.nodes.find((n) => n.type === 'decision')!;
    expect(proposal.findings[0]!.relatedNodeKeys).toEqual([decision.elementKey]);
    expect(proposal.findings.every((f) => f.status === 'draft')).toBe(true);
  });

  it('lays nodes out left to right', () => {
    const proposal = analysisToProposal(DEBT_WRITE_OFF_ANALYSIS);
    const start = proposal.nodes.find((n) => n.type === 'start')!;
    const retrieve = proposal.nodes[1]!;
    expect(retrieve.position.x).toBeGreaterThan(start.position.x);
  });

  it('does not invent start or end events', () => {
    const analysis = clone();
    analysis.steps = analysis.steps.filter((s) => s.type !== 'start');
    analysis.flows = analysis.flows.filter((f) => f.from !== 'S1');
    const proposal = analysisToProposal(analysis);
    expect(proposal.nodes.some((n) => n.type === 'start')).toBe(false);
    const graph = resolveProposalActors(proposal, []);
    expect(validateProcess(graph).map((i) => i.code)).toContain('MISSING_START');
  });
});

describe('resolveProposalActors', () => {
  it('attaches stored actor ids by case-insensitive name', () => {
    const proposal = analysisToProposal(DEBT_WRITE_OFF_ANALYSIS);
    const graph = resolveProposalActors(proposal, [
      { id: 'a1', name: 'finance officer', kind: 'role' },
      { id: 'a2', name: 'Supervisor', kind: 'role' },
    ]);
    expect(graph.nodes[1]!.actorId).toBe('a1');
    expect(graph.nodes[4]!.actorId).toBe('a2');
    expect(graph.nodes[5]!.actorId).toBeNull();
    expect(graph.nodes[0]).not.toHaveProperty('actorName');
  });

  it('produces a graph with no structural errors for the reference example', () => {
    const proposal = analysisToProposal(DEBT_WRITE_OFF_ANALYSIS);
    const actors = proposal.actors.map((a, i) => ({ id: `a${i}`, ...a }));
    const graph = resolveProposalActors(proposal, actors);
    const issues = validateProcess({ ...graph, actors, findings: proposal.findings });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    // The open question raised by the AI is surfaced as a warning.
    expect(issues.some((i) => i.code === 'OPEN_QUESTION')).toBe(true);
  });
});
