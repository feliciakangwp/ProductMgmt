/**
 * Core process-model types shared by the web app, the API and the database
 * layer. Nodes and edges are identified by `elementKey`, a lineage identifier
 * that stays constant when a version is copied into a new draft. Future
 * modules (fields, stories, test scenarios) link to an element through it.
 */

export const NODE_TYPES = ['start', 'end', 'activity', 'decision', 'approval', 'system'] as const;
export type ProcessNodeType = (typeof NODE_TYPES)[number];

export const NODE_TYPE_LABELS: Record<ProcessNodeType, string> = {
  start: 'Start',
  end: 'End',
  activity: 'Activity',
  decision: 'Decision',
  approval: 'Approval',
  system: 'System Activity',
};

/** Node types that represent work and therefore need a responsible actor. */
export const ACTOR_REQUIRED_TYPES: readonly ProcessNodeType[] = ['activity', 'approval', 'decision'];

export const EDGE_BRANCHES = ['yes', 'no', 'other'] as const;
export type EdgeBranch = (typeof EDGE_BRANCHES)[number];

export const ACTOR_KINDS = ['role', 'system', 'external'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const PROCESS_TYPES = ['as_is', 'to_be'] as const;
export type ProcessType = (typeof PROCESS_TYPES)[number];

export const VERSION_STATUSES = ['draft', 'approved', 'superseded'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const ORIGINS = ['stated', 'inferred', 'manual'] as const;
/** Where a piece of the model came from: quoted from the description, inferred by AI, or entered by a user. */
export type Origin = (typeof ORIGINS)[number];

export interface Position {
  x: number;
  y: number;
}

export interface ProcessNode {
  elementKey: string;
  /** Human-readable identifier assigned by the database on first save, e.g. ACT-004. */
  refCode: string | null;
  type: ProcessNodeType;
  label: string;
  description: string;
  actorId: string | null;
  position: Position;
  origin: Origin;
  /** Excerpt of the process description this node was derived from. */
  sourceText: string | null;
}

export interface ProcessEdge {
  elementKey: string;
  source: string;
  target: string;
  label: string;
  /** Condition under which this path is taken, for decision branches. */
  condition: string;
  branch: EdgeBranch | null;
}

export interface Actor {
  id: string;
  name: string;
  kind: ActorKind;
}

export const FINDING_KINDS = ['business_rule', 'exception', 'missing_information', 'ambiguity'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const FINDING_KIND_LABELS: Record<FindingKind, string> = {
  business_rule: 'Business rule',
  exception: 'Exception scenario',
  missing_information: 'Missing information',
  ambiguity: 'Ambiguity',
};

export const FINDING_STATUSES = ['draft', 'accepted', 'dismissed'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/**
 * Something AI (or a BA) identified while analysing the description that is
 * not itself a node: a business rule, exception, or gap. Findings stay in
 * Draft until a user accepts or dismisses them.
 */
export interface ProcessFinding {
  elementKey: string;
  kind: FindingKind;
  statement: string;
  sourceText: string | null;
  origin: Origin;
  status: FindingStatus;
  relatedNodeKeys: string[];
}

export interface ProcessGraph {
  nodes: ProcessNode[];
  edges: ProcessEdge[];
}
