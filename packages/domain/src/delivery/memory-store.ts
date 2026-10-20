import type { ProjectRole } from '../roles';
import type { DeliveryEntities, DeliveryKind, DeliveryStore } from './service';
import type { ProjectContext } from './trace';
import type { DeliverySettings } from './types';

/** Delivery records held in memory: the in-browser demo persists this object, tests start from an empty one. */
export type DeliveryTables = { [K in DeliveryKind]: DeliveryEntities[K][] } & { settings: DeliverySettings[] };

export const emptyDeliveryTables = (): DeliveryTables => ({
  stories: [],
  sprints: [],
  sprintItems: [],
  scenarios: [],
  executions: [],
  defects: [],
  events: [],
  insights: [],
  settings: [],
});

export interface MemoryStoreHooks {
  tables(): DeliveryTables;
  memberRole(projectId: string, userId: string): ProjectRole | null;
  context(projectId: string): ProjectContext;
  nextRef(projectId: string, prefix: string): string;
  processProject(processId: string): string | null;
}

const copy = <T>(value: T): T => structuredClone(value);

/** A delivery store over plain arrays. Records are copied in and out, as a database would. */
export function createMemoryDeliveryStore(hooks: MemoryStoreHooks): DeliveryStore {
  const table = <K extends DeliveryKind>(kind: K) => hooks.tables()[kind] as DeliveryEntities[K][];
  return {
    async memberRole(projectId, userId) {
      return hooks.memberRole(projectId, userId);
    },
    async context(projectId) {
      return copy(hooks.context(projectId));
    },
    async list(kind, projectId) {
      return copy(table(kind).filter((r) => r.projectId === projectId));
    },
    async get(kind, id) {
      const row = table(kind).find((r) => r.id === id);
      return row ? copy(row) : null;
    },
    async insert(kind, row) {
      if (table(kind).some((r) => r.id === row.id)) throw new Error(`Duplicate ${kind} id`);
      table(kind).push(copy(row));
    },
    async update(kind, row, expectedRevision) {
      const rows = table(kind);
      const index = rows.findIndex((r) => r.id === row.id);
      if (index < 0) return false;
      const current = rows[index] as { revision?: number };
      if (expectedRevision !== undefined && current.revision !== expectedRevision) return false;
      rows[index] = copy(row);
      return true;
    },
    async remove(kind, id) {
      const rows = table(kind);
      const index = rows.findIndex((r) => r.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    async nextRef(projectId, prefix) {
      return hooks.nextRef(projectId, prefix);
    },
    async processProject(processId) {
      return hooks.processProject(processId);
    },
    async getSettings(projectId) {
      const row = hooks.tables().settings.find((s) => s.projectId === projectId);
      return row ? copy(row) : null;
    },
    async saveSettings(settings, expectedRevision) {
      const rows = hooks.tables().settings;
      const index = rows.findIndex((s) => s.projectId === settings.projectId);
      const current = index >= 0 ? rows[index]!.revision : 0;
      if (current !== expectedRevision) return false;
      if (index >= 0) rows[index] = copy(settings);
      else rows.push(copy(settings));
      return true;
    },
  };
}
