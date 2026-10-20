/** Generates a new lineage key for a process element. */
export function newKey(): string {
  return globalThis.crypto.randomUUID();
}

export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
