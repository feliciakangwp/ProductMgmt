import type { FieldSuggestions, RuleTranslation, SuggestedField } from '../data/ai-schema';
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

// ---------------------------------------------------------------------------
// Phase 2
// ---------------------------------------------------------------------------

type FieldSpec = Omit<
  SuggestedField,
  'existingFieldRef' | 'origin' | 'rationale' | 'allowedValues' | 'sourceDetail' | 'mandatoryCondition'
> &
  Partial<Pick<SuggestedField, 'allowedValues' | 'sourceDetail' | 'mandatoryCondition' | 'origin'>>;

const field = (spec: FieldSpec): SuggestedField => ({
  existingFieldRef: null,
  allowedValues: [],
  sourceDetail: '',
  mandatoryCondition: '',
  origin: 'inferred',
  rationale: '',
  ...spec,
});

/** Field suggestions for the debt write-off activities, keyed by activity label. */
export const DEBT_WRITE_OFF_FIELD_SUGGESTIONS: Record<string, Omit<FieldSuggestions['activities'][number], 'activityId'>> = {
  'Retrieve debt record': {
    inputs: [
      field({
        name: 'Debt ID',
        dataType: 'reference',
        description: 'Identifier of the debt record',
        source: 'user_entered',
        mandatory: 'yes',
        origin: 'stated',
      }),
    ],
    outputFields: [
      field({
        name: 'Debtor Name',
        dataType: 'string',
        description: 'Name of the debtor',
        source: 'retrieved',
        sourceDetail: 'Debt record',
        mandatory: 'no',
      }),
      field({
        name: 'Outstanding Amount',
        dataType: 'currency',
        description: 'Amount still owed',
        source: 'retrieved',
        sourceDetail: 'Debt record',
        mandatory: 'no',
      }),
      field({
        name: 'Debt Start Date',
        dataType: 'date',
        description: 'Date the debt became outstanding',
        source: 'retrieved',
        sourceDetail: 'Debt record',
        mandatory: 'no',
        origin: 'stated',
      }),
    ],
    otherOutputs: [],
  },
  'Outstanding more than five years?': {
    inputs: [
      field({
        name: 'Debt Start Date',
        dataType: 'date',
        description: 'Date the debt became outstanding',
        source: 'retrieved',
        sourceDetail: 'Debt record',
        mandatory: 'yes',
        origin: 'stated',
      }),
    ],
    outputFields: [],
    otherOutputs: [],
  },
  'Submit request to supervisor': {
    inputs: [
      field({
        name: 'Debt ID',
        dataType: 'reference',
        description: 'Identifier of the debt record',
        source: 'user_entered',
        mandatory: 'yes',
      }),
      field({
        name: 'Outstanding Amount',
        dataType: 'currency',
        description: 'Amount still owed',
        source: 'retrieved',
        sourceDetail: 'Debt record',
        mandatory: 'yes',
      }),
      field({
        name: 'Write-Off Reason',
        dataType: 'text',
        description: 'Why the debt should be written off',
        source: 'user_entered',
        mandatory: 'yes',
      }),
      field({
        name: 'Supporting Document',
        dataType: 'file',
        description: 'Evidence supporting the request',
        source: 'user_entered',
        mandatory: 'conditional',
        mandatoryCondition: 'Required when the outstanding amount exceeds $10,000',
      }),
    ],
    outputFields: [
      field({
        name: 'Write-Off Request ID',
        dataType: 'string',
        description: 'Identifier of the request',
        source: 'system_generated',
        mandatory: 'no',
      }),
      field({
        name: 'Request Status',
        dataType: 'enum',
        allowedValues: ['Pending Approval', 'Approved', 'Rejected'],
        description: 'Where the request is in the approval process',
        source: 'system_generated',
        mandatory: 'no',
      }),
    ],
    otherOutputs: [
      {
        kind: 'notification',
        target: 'Supervisor',
        description: 'A new write-off request is waiting for review',
        origin: 'inferred',
      },
    ],
  },
  'Review write-off request': {
    inputs: [
      field({
        name: 'Write-Off Request ID',
        dataType: 'string',
        description: 'Identifier of the request',
        source: 'system_generated',
        mandatory: 'yes',
      }),
      field({
        name: 'Approval Decision',
        dataType: 'enum',
        allowedValues: ['Approve', 'Reject'],
        description: 'The supervisor decision',
        source: 'user_entered',
        mandatory: 'yes',
        origin: 'stated',
      }),
      field({
        name: 'Rejection Reason',
        dataType: 'text',
        description: 'Why the request was rejected',
        source: 'user_entered',
        mandatory: 'conditional',
        mandatoryCondition: 'Required when the decision is Reject',
      }),
    ],
    outputFields: [
      field({
        name: 'Approver ID',
        dataType: 'string',
        description: 'Who made the decision',
        source: 'system_generated',
        mandatory: 'no',
      }),
      field({
        name: 'Approval Date',
        dataType: 'date',
        description: 'When the decision was made',
        source: 'system_generated',
        mandatory: 'no',
      }),
    ],
    otherOutputs: [
      { kind: 'record_update', target: 'Write-off request', description: 'Decision recorded on the request', origin: 'inferred' },
    ],
  },
  'Update debt status to Written Off': {
    inputs: [
      field({
        name: 'Debt ID',
        dataType: 'reference',
        description: 'Identifier of the debt record',
        source: 'user_entered',
        mandatory: 'yes',
      }),
    ],
    outputFields: [
      field({
        name: 'Debt Status',
        dataType: 'enum',
        allowedValues: ['Active', 'Written Off'],
        description: 'Lifecycle status of the debt',
        source: 'system_generated',
        mandatory: 'no',
        origin: 'stated',
      }),
    ],
    otherOutputs: [
      {
        kind: 'status_change',
        target: 'Debt status: Written Off',
        description: 'The debt is closed as written off',
        origin: 'stated',
      },
      { kind: 'record_update', target: 'Audit record', description: 'Audit entry for the write-off', origin: 'inferred' },
    ],
  },
};

/**
 * Builds a field-suggestion answer for whichever activities a prompt lists,
 * by matching their labels ("- A3 [activity, ACT-002] Submit request …").
 */
export function fieldSuggestionsForPrompt(prompt: string): FieldSuggestions {
  const activities: FieldSuggestions['activities'] = [];
  for (const line of prompt.split('\n')) {
    const match = line.match(/^- (A\d+) \[[^\]]+\] (.+?)(?: \(actor: .*)?(?: — .*)?$/);
    if (!match) continue;
    const spec = DEBT_WRITE_OFF_FIELD_SUGGESTIONS[match[2]!.trim()];
    if (spec) activities.push({ activityId: match[1]!, ...spec });
  }
  return { activities, questions: ['Is a supporting document always required, or only above a threshold amount?'] };
}

export const OUTSTANDING_AMOUNT_RULE_TEXT =
  'Outstanding amount must be greater than zero. If the amount exceeds $10,000, Director approval is required.';

export const OUTSTANDING_AMOUNT_TRANSLATION: RuleTranslation = {
  rules: [
    {
      ruleType: 'range',
      statement: 'Outstanding amount must be greater than zero.',
      errorMessage: 'Enter an outstanding amount greater than zero.',
      min: 0,
      max: null,
      exclusive: true,
      minLength: null,
      maxLength: null,
      pattern: null,
      condition: null,
      otherFieldRef: null,
      lookupSource: null,
    },
  ],
  businessRules: [
    {
      title: 'Director approval above $10,000',
      statement: 'Write-off requests where the outstanding amount exceeds $10,000 require Director approval.',
      category: 'approval',
    },
  ],
  questions: [],
};
