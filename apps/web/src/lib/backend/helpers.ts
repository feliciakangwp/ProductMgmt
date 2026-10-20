import type { PromotableFinding } from './types';

/**
 * A finding is copied into every new version of its process; list each
 * finding once, from the newest version that has it.
 */
export function latestFindingPerKey(rows: PromotableFinding[]): PromotableFinding[] {
  const byKey = new Map<string, PromotableFinding>();
  for (const row of rows) {
    const existing = byKey.get(row.findingKey);
    if (!existing || row.versionNumber > existing.versionNumber) byKey.set(row.findingKey, row);
  }
  return [...byKey.values()].sort((a, b) => a.processRef.localeCompare(b.processRef));
}
