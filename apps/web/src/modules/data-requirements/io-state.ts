import type { ActivityField, ActivityOutput, VersionDataRequirements } from '@productflow/domain';

/** Editor state for one process version's inputs and outputs. */
export interface IoState {
  versionId: string;
  dataRevision: number;
  requirements: VersionDataRequirements;
  dirty: boolean;
}

export type IoAction =
  | { type: 'load'; versionId: string; dataRevision: number; requirements: VersionDataRequirements }
  | { type: 'set'; requirements: VersionDataRequirements }
  | { type: 'updateField'; elementKey: string; patch: Partial<ActivityField> }
  | { type: 'removeField'; elementKey: string }
  | { type: 'addField'; field: ActivityField }
  | { type: 'updateOutput'; elementKey: string; patch: Partial<ActivityOutput> }
  | { type: 'removeOutput'; elementKey: string }
  | { type: 'addOutput'; output: ActivityOutput }
  /** The save stored exactly `requirements`; edits made meanwhile stay dirty. */
  | { type: 'saved'; dataRevision: number; requirements: VersionDataRequirements };

export function ioReducer(state: IoState, action: IoAction): IoState {
  const withRequirements = (requirements: VersionDataRequirements): IoState => ({ ...state, requirements, dirty: true });
  const r = state.requirements;
  switch (action.type) {
    case 'load':
      return { versionId: action.versionId, dataRevision: action.dataRevision, requirements: action.requirements, dirty: false };
    case 'set':
      return withRequirements(action.requirements);
    case 'updateField':
      return withRequirements({
        ...r,
        fields: r.fields.map((f) => (f.elementKey === action.elementKey ? { ...f, ...action.patch } : f)),
      });
    case 'removeField':
      return withRequirements({ ...r, fields: r.fields.filter((f) => f.elementKey !== action.elementKey) });
    case 'addField': {
      const f = action.field;
      const duplicate = r.fields.some((x) => x.nodeKey === f.nodeKey && x.direction === f.direction && x.fieldId === f.fieldId);
      return duplicate ? state : withRequirements({ ...r, fields: [...r.fields, f] });
    }
    case 'updateOutput':
      return withRequirements({
        ...r,
        outputs: r.outputs.map((o) => (o.elementKey === action.elementKey ? { ...o, ...action.patch } : o)),
      });
    case 'removeOutput':
      return withRequirements({ ...r, outputs: r.outputs.filter((o) => o.elementKey !== action.elementKey) });
    case 'addOutput':
      return withRequirements({ ...r, outputs: [...r.outputs, action.output] });
    case 'saved':
      return { ...state, dataRevision: action.dataRevision, dirty: state.requirements !== action.requirements };
  }
}

/** Next sort position for a new row of one activity. */
export function nextSortOrder(rows: { nodeKey: string; sortOrder: number }[], nodeKey: string): number {
  return rows.filter((r) => r.nodeKey === nodeKey).reduce((max, r) => Math.max(max, r.sortOrder + 1), 0);
}
