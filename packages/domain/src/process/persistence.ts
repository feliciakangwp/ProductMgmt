import type {
  ActorKind,
  EdgeBranch,
  FindingKind,
  FindingStatus,
  Origin,
  ProcessEdge,
  ProcessFinding,
  ProcessGraph,
  ProcessNode,
  ProcessNodeType,
  ProcessType,
  VersionStatus,
} from './types';

/**
 * Database row shapes (snake_case, as returned by PostgREST) and the
 * conversions between them and the domain model. The save payload produced
 * here is what `save_process_draft` in supabase/migrations expects.
 */

export interface ProjectRow {
  id: string;
  key: string;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProcessRow {
  id: string;
  project_id: string;
  ref_code: string;
  name: string;
  process_type: ProcessType;
  owner: string;
  business_unit: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProcessVersionRow {
  id: string;
  process_id: string;
  project_id: string;
  version_number: number;
  status: VersionStatus;
  description: string;
  revision: number;
  /** Optimistic-locking revision of the version's data requirements (Phase 2). */
  data_revision: number;
  based_on_version_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

export interface ActorRow {
  id: string;
  project_id: string;
  name: string;
  kind: ActorKind;
  description: string;
}

export interface ProcessNodeRow {
  id: string;
  version_id: string;
  project_id: string;
  element_key: string;
  ref_code: string | null;
  node_type: ProcessNodeType;
  label: string;
  description: string;
  actor_id: string | null;
  position_x: number;
  position_y: number;
  origin: Origin;
  source_text: string | null;
}

export interface ProcessEdgeRow {
  id: string;
  version_id: string;
  project_id: string;
  element_key: string;
  source_key: string;
  target_key: string;
  label: string;
  condition: string;
  branch: EdgeBranch | null;
}

export interface ProcessFindingRow {
  id: string;
  version_id: string;
  project_id: string;
  element_key: string;
  kind: FindingKind;
  statement: string;
  source_text: string | null;
  origin: Origin;
  status: FindingStatus;
  related_node_keys: string[];
  analysis_run_id: string | null;
}

export function nodeFromRow(row: ProcessNodeRow): ProcessNode {
  return {
    elementKey: row.element_key,
    refCode: row.ref_code,
    type: row.node_type,
    label: row.label,
    description: row.description,
    actorId: row.actor_id,
    position: { x: Number(row.position_x), y: Number(row.position_y) },
    origin: row.origin,
    sourceText: row.source_text,
  };
}

export function edgeFromRow(row: ProcessEdgeRow): ProcessEdge {
  return {
    elementKey: row.element_key,
    source: row.source_key,
    target: row.target_key,
    label: row.label,
    condition: row.condition,
    branch: row.branch,
  };
}

export function findingFromRow(row: ProcessFindingRow): ProcessFinding {
  return {
    elementKey: row.element_key,
    kind: row.kind,
    statement: row.statement,
    sourceText: row.source_text,
    origin: row.origin,
    status: row.status,
    relatedNodeKeys: row.related_node_keys ?? [],
  };
}

export function graphFromRows(nodes: ProcessNodeRow[], edges: ProcessEdgeRow[]): ProcessGraph {
  return { nodes: nodes.map(nodeFromRow), edges: edges.map(edgeFromRow) };
}

export interface SaveNodePayload {
  element_key: string;
  node_type: ProcessNodeType;
  label: string;
  description: string;
  actor_id: string | null;
  position_x: number;
  position_y: number;
  origin: Origin;
  source_text: string | null;
}

export interface SaveEdgePayload {
  element_key: string;
  source_key: string;
  target_key: string;
  label: string;
  condition: string;
  branch: EdgeBranch | null;
}

export interface SaveFindingPayload {
  element_key: string;
  kind: FindingKind;
  statement: string;
  source_text: string | null;
  origin: Origin;
  status: FindingStatus;
  related_node_keys: string[];
}

export interface SaveDraftPayload {
  p_version_id: string;
  p_expected_revision: number;
  p_description: string;
  p_nodes: SaveNodePayload[];
  p_edges: SaveEdgePayload[];
  p_findings: SaveFindingPayload[];
  p_analysis_run_id: string | null;
}

/**
 * Builds the arguments for `save_process_draft`. Ref codes are not sent: the
 * database assigns them and keeps existing ones for known element keys.
 * Edges whose ends are missing are dropped so the save cannot fail on a
 * foreign key the user cannot see.
 */
export function toSavePayload(args: {
  versionId: string;
  expectedRevision: number;
  description: string;
  graph: ProcessGraph;
  findings: ProcessFinding[];
  analysisRunId?: string | null;
}): SaveDraftPayload {
  const { graph } = args;
  const keys = new Set(graph.nodes.map((n) => n.elementKey));
  return {
    p_version_id: args.versionId,
    p_expected_revision: args.expectedRevision,
    p_description: args.description,
    p_nodes: graph.nodes.map((n) => ({
      element_key: n.elementKey,
      node_type: n.type,
      label: n.label,
      description: n.description,
      actor_id: n.actorId,
      position_x: Math.round(n.position.x * 100) / 100,
      position_y: Math.round(n.position.y * 100) / 100,
      origin: n.origin,
      source_text: n.sourceText,
    })),
    p_edges: graph.edges
      .filter((e) => keys.has(e.source) && keys.has(e.target))
      .map((e) => ({
        element_key: e.elementKey,
        source_key: e.source,
        target_key: e.target,
        label: e.label,
        condition: e.condition,
        branch: e.branch,
      })),
    p_findings: args.findings.map((f) => ({
      element_key: f.elementKey,
      kind: f.kind,
      statement: f.statement,
      source_text: f.sourceText,
      origin: f.origin,
      status: f.status,
      related_node_keys: f.relatedNodeKeys.filter((k) => keys.has(k)),
    })),
    p_analysis_run_id: args.analysisRunId ?? null,
  };
}
