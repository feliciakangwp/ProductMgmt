import { newKey, normaliseName } from '../ids';
import type { ProcessAnalysis } from './ai-schema';
import { layoutGraph } from './layout';
import type { Actor, ActorKind, ProcessEdge, ProcessFinding, ProcessGraph, ProcessNode } from './types';

/** A node proposed by AI, still referencing its actor by name. */
export interface ProposedNode extends ProcessNode {
  actorName: string | null;
}

export interface ProposedActor {
  name: string;
  kind: ActorKind;
}

/**
 * The reviewable result of an analysis run. Nothing here is persisted until
 * the user accepts it into a draft and saves.
 */
export interface ProcessProposal {
  processName: string;
  summary: string;
  actors: ProposedActor[];
  nodes: ProposedNode[];
  edges: ProcessEdge[];
  findings: ProcessFinding[];
}

/**
 * Converts a validated AI analysis into graph form: assigns lineage keys,
 * maps step ids to keys, attaches actors by name and lays the graph out.
 * Does not add start/end events the AI did not identify; validation reports
 * those gaps to the analyst instead.
 */
export function analysisToProposal(analysis: ProcessAnalysis): ProcessProposal {
  const keyByStepId = new Map<string, string>();
  for (const step of analysis.steps) keyByStepId.set(step.id, newKey());

  // Actors referenced by steps but missing from the actors list are added so
  // no responsibility is silently dropped.
  const actors: ProposedActor[] = [];
  const seen = new Set<string>();
  const addActor = (name: string, kind: ActorKind) => {
    const trimmed = name.trim();
    const norm = normaliseName(trimmed);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    actors.push({ name: trimmed, kind });
  };
  for (const actor of analysis.actors) addActor(actor.name, actor.kind);
  for (const step of analysis.steps) {
    if (step.actor) addActor(step.actor, step.type === 'system' ? 'system' : 'role');
  }
  const canonicalName = new Map(actors.map((a) => [normaliseName(a.name), a.name]));

  const nodes: ProposedNode[] = analysis.steps.map((step) => ({
    elementKey: keyByStepId.get(step.id)!,
    refCode: null,
    type: step.type,
    label: step.label.trim(),
    description: step.description.trim(),
    actorId: null,
    actorName: step.actor ? (canonicalName.get(normaliseName(step.actor)) ?? null) : null,
    position: { x: 0, y: 0 },
    origin: step.origin,
    sourceText: step.sourceText,
  }));

  const edges: ProcessEdge[] = [];
  for (const flow of analysis.flows) {
    const source = keyByStepId.get(flow.from);
    const target = keyByStepId.get(flow.to);
    if (!source || !target) continue;
    edges.push({
      elementKey: newKey(),
      source,
      target,
      label: flow.label.trim() || defaultBranchLabel(flow.branch),
      condition: flow.condition.trim(),
      branch: flow.branch,
    });
  }

  const findings: ProcessFinding[] = analysis.findings.map((finding) => ({
    elementKey: newKey(),
    kind: finding.kind,
    statement: finding.statement.trim(),
    sourceText: finding.sourceText,
    origin: finding.origin,
    status: 'draft',
    relatedNodeKeys: finding.relatedStepIds.map((id) => keyByStepId.get(id)).filter((key): key is string => Boolean(key)),
  }));

  return {
    processName: analysis.processName.trim(),
    summary: analysis.summary.trim(),
    actors,
    nodes: layoutGraph(nodes, edges),
    edges,
    findings,
  };
}

function defaultBranchLabel(branch: ProcessEdge['branch']): string {
  if (branch === 'yes') return 'Yes';
  if (branch === 'no') return 'No';
  return '';
}

/**
 * Resolves proposed actor names to stored actor ids (matching
 * case-insensitively) and returns a plain graph ready for the editor.
 */
export function resolveProposalActors(proposal: ProcessProposal, actors: Actor[]): ProcessGraph {
  const idByName = new Map(actors.map((a) => [normaliseName(a.name), a.id]));
  const nodes: ProcessNode[] = proposal.nodes.map(({ actorName, ...node }) => ({
    ...node,
    actorId: actorName ? (idByName.get(normaliseName(actorName)) ?? null) : null,
  }));
  return { nodes, edges: proposal.edges };
}
