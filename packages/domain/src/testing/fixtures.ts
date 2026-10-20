import type { ProcessAnalysis } from '../process/ai-schema';

/** Example process description from the product brief. */
export const DEBT_WRITE_OFF_DESCRIPTION = `When a Finance Officer receives a request for debt write-off, the officer retrieves the debt record.

The officer checks whether the debt has been outstanding for more than five years.

If eligible, the officer submits the request to the supervisor.

The supervisor reviews the request.

If approved, the system updates the debt status to Written Off.

If rejected, the request returns to the Finance Officer.`;

/** A well-formed analysis of {@link DEBT_WRITE_OFF_DESCRIPTION}, as Claude would return it. */
export const DEBT_WRITE_OFF_ANALYSIS: ProcessAnalysis = {
  processName: 'Debt Write-Off',
  summary: 'A Finance Officer checks eligibility of a debt and a Supervisor approves or rejects the write-off.',
  actors: [
    { name: 'Finance Officer', kind: 'role' },
    { name: 'Supervisor', kind: 'role' },
    { name: 'Debt Management System', kind: 'system' },
  ],
  steps: [
    {
      id: 'S1',
      type: 'start',
      label: 'Write-off request received',
      description: '',
      actor: 'Finance Officer',
      origin: 'stated',
      sourceText: 'When a Finance Officer receives a request for debt write-off',
    },
    {
      id: 'S2',
      type: 'activity',
      label: 'Retrieve debt record',
      description: 'Officer retrieves the debt record.',
      actor: 'Finance Officer',
      origin: 'stated',
      sourceText: 'the officer retrieves the debt record',
    },
    {
      id: 'S3',
      type: 'decision',
      label: 'Outstanding more than five years?',
      description: '',
      actor: 'Finance Officer',
      origin: 'stated',
      sourceText: 'checks whether the debt has been outstanding for more than five years',
    },
    {
      id: 'S4',
      type: 'activity',
      label: 'Submit request to supervisor',
      description: '',
      actor: 'Finance Officer',
      origin: 'stated',
      sourceText: 'If eligible, the officer submits the request to the supervisor.',
    },
    {
      id: 'S5',
      type: 'approval',
      label: 'Review write-off request',
      description: '',
      actor: 'Supervisor',
      origin: 'stated',
      sourceText: 'The supervisor reviews the request.',
    },
    {
      id: 'S6',
      type: 'system',
      label: 'Update debt status to Written Off',
      description: '',
      actor: 'Debt Management System',
      origin: 'stated',
      sourceText: 'the system updates the debt status to Written Off',
    },
    { id: 'S7', type: 'end', label: 'Debt written off', description: '', actor: null, origin: 'inferred', sourceText: null },
    { id: 'S8', type: 'end', label: 'Request not eligible', description: '', actor: null, origin: 'inferred', sourceText: null },
  ],
  flows: [
    { from: 'S1', to: 'S2', branch: null, label: '', condition: '' },
    { from: 'S2', to: 'S3', branch: null, label: '', condition: '' },
    { from: 'S3', to: 'S4', branch: 'yes', label: 'Eligible', condition: 'Debt outstanding > 5 years' },
    { from: 'S3', to: 'S8', branch: 'no', label: '', condition: 'Debt outstanding <= 5 years' },
    { from: 'S4', to: 'S5', branch: null, label: '', condition: '' },
    { from: 'S5', to: 'S6', branch: 'yes', label: 'Approved', condition: '' },
    { from: 'S5', to: 'S2', branch: 'no', label: 'Rejected', condition: '' },
    { from: 'S6', to: 'S7', branch: null, label: '', condition: '' },
  ],
  findings: [
    {
      kind: 'business_rule',
      statement: 'A debt is eligible for write-off only if it has been outstanding for more than five years.',
      sourceText: 'outstanding for more than five years',
      origin: 'stated',
      relatedStepIds: ['S3'],
    },
    {
      kind: 'missing_information',
      statement: 'What happens to an ineligible request? The description does not say.',
      sourceText: null,
      origin: 'inferred',
      relatedStepIds: ['S3', 'S8'],
    },
    {
      kind: 'exception',
      statement: 'A rejected request returns to the Finance Officer.',
      sourceText: 'If rejected, the request returns to the Finance Officer.',
      origin: 'stated',
      relatedStepIds: ['S5'],
    },
  ],
};
