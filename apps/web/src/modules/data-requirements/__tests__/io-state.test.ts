import type { ActivityField, VersionDataRequirements } from '@productflow/domain';
import { describe, expect, it } from 'vitest';
import { describeParams } from '../format';
import { ioReducer, nextSortOrder, type IoState } from '../io-state';

const use = (patch: Partial<ActivityField>): ActivityField => ({
  elementKey: 'a',
  nodeKey: 'n1',
  fieldId: 'f1',
  direction: 'input',
  mandatory: 'yes',
  mandatoryCondition: '',
  notes: '',
  origin: 'manual',
  sortOrder: 0,
  ...patch,
});

const initial: IoState = { versionId: 'v', dataRevision: 1, requirements: { fields: [use({})], outputs: [] }, dirty: false };

describe('ioReducer', () => {
  it('edits, adds and removes rows and marks the state dirty', () => {
    let s = ioReducer(initial, {
      type: 'updateField',
      elementKey: 'a',
      patch: { mandatory: 'conditional', mandatoryCondition: 'If X' },
    });
    expect(s.requirements.fields[0]).toMatchObject({ mandatory: 'conditional', mandatoryCondition: 'If X' });
    expect(s.dirty).toBe(true);
    s = ioReducer(s, { type: 'addField', field: use({ elementKey: 'b', fieldId: 'f2', sortOrder: 1 }) });
    expect(s.requirements.fields).toHaveLength(2);
    s = ioReducer(s, {
      type: 'addOutput',
      output: {
        elementKey: 'o',
        nodeKey: 'n1',
        kind: 'notification',
        target: 'Supervisor',
        description: '',
        origin: 'manual',
        sortOrder: 0,
      },
    });
    s = ioReducer(s, { type: 'updateOutput', elementKey: 'o', patch: { target: 'Director' } });
    expect(s.requirements.outputs[0]!.target).toBe('Director');
    s = ioReducer(s, { type: 'removeOutput', elementKey: 'o' });
    s = ioReducer(s, { type: 'removeField', elementKey: 'a' });
    expect(s.requirements).toEqual({ fields: [use({ elementKey: 'b', fieldId: 'f2', sortOrder: 1 })], outputs: [] });
  });

  it('ignores adding the same field twice to one activity and direction', () => {
    const s = ioReducer(initial, { type: 'addField', field: use({ elementKey: 'dup' }) });
    expect(s).toBe(initial);
    const output = ioReducer(initial, { type: 'addField', field: use({ elementKey: 'out', direction: 'output' }) });
    expect(output.requirements.fields).toHaveLength(2);
  });

  it('stays dirty when edits happened while saving', () => {
    const edited = ioReducer(initial, { type: 'updateField', elementKey: 'a', patch: { notes: 'x' } });
    const sent: VersionDataRequirements = edited.requirements;
    expect(ioReducer(edited, { type: 'saved', dataRevision: 2, requirements: sent })).toMatchObject({
      dirty: false,
      dataRevision: 2,
    });
    const later = ioReducer(edited, { type: 'updateField', elementKey: 'a', patch: { notes: 'y' } });
    expect(ioReducer(later, { type: 'saved', dataRevision: 2, requirements: sent }).dirty).toBe(true);
  });

  it('computes the next sort position per activity', () => {
    expect(
      nextSortOrder(
        [
          { nodeKey: 'n1', sortOrder: 3 },
          { nodeKey: 'n2', sortOrder: 9 },
        ],
        'n1',
      ),
    ).toBe(4);
    expect(nextSortOrder([], 'n1')).toBe(0);
  });
});

describe('describeParams', () => {
  const p = {
    min: null,
    max: null,
    exclusive: false,
    minLength: null,
    maxLength: null,
    pattern: null,
    condition: null,
    otherFieldId: null,
    lookupSource: null,
  };
  it('summarises parameters for each rule type', () => {
    expect(describeParams({ ruleType: 'range', params: { ...p, min: 0, exclusive: true } })).toBe('> 0');
    expect(describeParams({ ruleType: 'range', params: { ...p, min: 1, max: 10000 } })).toBe('≥ 1 and ≤ 10,000');
    expect(describeParams({ ruleType: 'length', params: { ...p, maxLength: 500 } })).toBe('at most 500 chars');
    expect(describeParams({ ruleType: 'lookup', params: { ...p, lookupSource: 'Debt records' } })).toBe('in Debt records');
    expect(describeParams({ ruleType: 'required', params: p })).toBe('');
  });
});
