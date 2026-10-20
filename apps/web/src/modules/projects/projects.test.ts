import { describe, expect, it } from 'vitest';
import { suggestProjectKey } from './ProjectsPage';

describe('suggestProjectKey', () => {
  it('uses initials for multi-word names', () => {
    expect(suggestProjectKey('Debt Management Modernisation')).toBe('DMM');
  });
  it('uses the start of a single word', () => {
    expect(suggestProjectKey('Payments')).toBe('PAYMENTS');
    expect(suggestProjectKey('Procurement Transformation 2027')).toBe('PT2');
  });
  it('never starts with a digit and returns empty for unusable names', () => {
    expect(suggestProjectKey('2027 Roadmap')).toMatch(/^[A-Z]/);
    expect(suggestProjectKey('!!')).toBe('');
  });
});
