import type { ProcessFinding, ProcessGraph } from '@productflow/domain';
import { useEffect } from 'react';
import { safeStorage } from '../../lib/storage';

/**
 * Crash protection for unsaved edits: the editor mirrors its unsaved state
 * into browser storage so a closed tab or crash does not lose work. The
 * database remains the record; a backup is only offered back when it was
 * made against the revision currently stored.
 */

export interface DraftBackup {
  revision: number;
  savedAt: string;
  description: string;
  graph: ProcessGraph;
  findings: ProcessFinding[];
}

const key = (versionId: string) => `productflow:draft:${versionId}`;

export function readDraftBackup(versionId: string): DraftBackup | null {
  const raw = safeStorage.get(key(versionId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DraftBackup;
    if (typeof parsed.revision !== 'number' || !parsed.graph || !Array.isArray(parsed.graph.nodes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraftBackup(versionId: string) {
  safeStorage.remove(key(versionId));
}

export function useDraftBackup(args: {
  versionId: string;
  enabled: boolean;
  dirty: boolean;
  revision: number;
  description: string;
  graph: ProcessGraph;
  findings: ProcessFinding[];
}) {
  const { versionId, enabled, dirty, revision, description, graph, findings } = args;
  useEffect(() => {
    if (!enabled || !dirty) return;
    const id = setTimeout(() => {
      const backup: DraftBackup = { revision, savedAt: new Date().toISOString(), description, graph, findings };
      safeStorage.set(key(versionId), JSON.stringify(backup));
    }, 800);
    return () => clearTimeout(id);
  }, [versionId, enabled, dirty, revision, description, graph, findings]);
}
