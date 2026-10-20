import {
  readPromptContext,
  type ChangeImpactAssessment,
  type ChangeImpactInput,
  type Improvement,
  type ImprovementInput,
  type Refinement,
  type RefinementInput,
  type ScenarioGeneration,
  type ScenarioGenerationInput,
  type StoryGeneration,
  type StoryGenerationInput,
  type TechnicalStoryGeneration,
  type TechnicalStoryInput,
} from '../delivery/ai';

/**
 * Well-formed answers to the delivery AI tasks, built from the context in
 * the prompt the way Claude would answer. Used by unit tests, the mock
 * Anthropic API in the end-to-end tests, and the offline demo.
 */

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function storiesForPrompt(prompt: string): StoryGeneration {
  const ctx = readPromptContext<StoryGenerationInput>(prompt);
  if (!ctx) return { stories: [], questions: ['The prompt had no context.'] };
  const existing = new Set(ctx.existingStories.map((s) => s.title.toLowerCase()));
  const stories = ctx.activities
    .filter((a) => !existing.has(a.label.toLowerCase()))
    .map((a) => {
      const mandatory = a.inputs.filter((i) => i.mandatory === 'yes');
      const conditional = a.inputs.filter((i) => i.mandatory === 'conditional');
      const rules = ctx.businessRules.filter((r) =>
        a.label
          .toLowerCase()
          .split(/\W+/)
          .some((w) => w.length > 5 && r.statement.toLowerCase().includes(w)),
      );
      return {
        title: a.label,
        activityIds: [a.id],
        userRole: a.actor ?? 'Business user',
        objective: `to ${lower(a.label)}`,
        benefit: `the ${ctx.processName.toLowerCase()} process can continue without manual follow-up`,
        description: a.description || `${a.actor ?? 'The user'} completes "${a.label}" in ${ctx.processName}.`,
        behaviour: [
          `${a.actor ?? 'The user'} opens the ${ctx.processName.toLowerCase()} work item.`,
          ...a.inputs.map((i) => `${a.actor ?? 'The user'} provides ${i.name}.`),
          `The system records the result of "${a.label}".`,
        ],
        alternativeFlows: conditional.map((i) => `When ${i.condition || 'the condition applies'}, ${i.name} is required.`),
        acceptanceCriteria: [
          ...(mandatory.length
            ? [`Given ${mandatory.map((i) => i.name).join(', ')} are provided, when the step is submitted, then it is recorded with the user and time.`]
            : [`Given the work item is open, when "${a.label}" is completed, then the outcome is recorded with the user and time.`]),
          ...mandatory.map((i) => `Given ${i.name} is missing, when the step is submitted, then the system rejects it and names ${i.name}.`),
        ],
        fieldRefs: [...a.inputs.map((i) => i.ref), ...a.outputs],
        businessRuleRefs: rules.map((r) => r.ref),
        origin: a.description ? ('stated' as const) : ('inferred' as const),
      };
    });
  return { stories, questions: stories.length ? ['Who is notified when a request is rejected?'] : [] };
}

export function technicalStoriesForPrompt(prompt: string): TechnicalStoryGeneration {
  const ctx = readPromptContext<TechnicalStoryInput>(prompt);
  if (!ctx) return { technicalStories: [], questions: [] };
  const fieldRefs = ctx.fields.map((f) => f.ref);
  const ruleRefs = ctx.validationRules.map((r) => r.ref);
  const known = ctx.knownColumns.length ? ctx.knownColumns.join('; ') : 'no physical columns are recorded yet';
  return {
    technicalStories: [
      {
        title: `API: ${ctx.story.title}`,
        objective: `Provide a service operation that lets the ${ctx.story.userRole || 'user'} ${lower(ctx.story.title)}.`,
        apiBehaviour: `Proposed: a POST endpoint that accepts ${ctx.fields.map((f) => f.name).join(', ') || 'the step data'} and records the outcome.`,
        requiredData: `Reads and writes ${ctx.fields.map((f) => `${f.ref} ${f.name}`).join(', ') || 'the work item'}. Known columns: ${known}.`,
        validationLogic: ruleRefs.length ? `Apply ${ruleRefs.join(', ')} before saving.` : 'Reject requests with missing mandatory fields.',
        expectedResponse: 'Returns the updated work item with its new status.',
        errorScenarios: ['Missing mandatory field: 422 naming the field.', 'Record changed by someone else: 409 conflict.'],
        acceptanceCriteria: ['The endpoint rejects invalid input with a field-level error.', 'A successful call is recorded in the audit log.'],
        fieldRefs,
        validationRuleRefs: ruleRefs,
        assumptions: ['Proposed endpoint and payload shape need developer confirmation.'],
      },
      ...(ruleRefs.length
        ? [
            {
              title: `Validation: ${ctx.story.title}`,
              objective: 'Enforce the confirmed validation rules on the server.',
              apiBehaviour: 'Proposed: a shared validation module used by the endpoint.',
              requiredData: ctx.validationRules.map((r) => `${r.fieldRef}: ${r.statement}`).join(' '),
              validationLogic: ctx.validationRules.map((r) => `${r.ref}: ${r.statement}`).join(' '),
              expectedResponse: 'Validation errors list every failed rule with its message.',
              errorScenarios: ['A rule fails: the request is rejected and nothing is saved.'],
              acceptanceCriteria: ctx.validationRules.map((r) => `${r.ref} is enforced: ${r.statement}`),
              fieldRefs: [...new Set(ctx.validationRules.map((r) => r.fieldRef).filter((r) => fieldRefs.includes(r)))],
              validationRuleRefs: ruleRefs,
              assumptions: [],
            },
          ]
        : []),
    ],
    questions: [],
  };
}

export function scenariosForPrompt(prompt: string): ScenarioGeneration {
  const ctx = readPromptContext<ScenarioGenerationInput>(prompt);
  if (!ctx) return { scenarios: [], questions: [] };
  const technical = ctx.stories.filter((s) => s.type === 'technical');
  return {
    scenarios: ctx.stories
      .filter((s) => s.type === 'functional')
      .flatMap((s) => {
        const tech = technical.filter((t) => t.implements.includes(s.ref)).map((t) => t.ref);
        const main = {
          title: `${s.title}: main flow`,
          scenarioType: 'main' as const,
          description: `Confirms ${lower(s.title)} works end to end.`,
          preconditions: ['The tester is signed in with the right role.', 'Test records exist for the scenario.'],
          steps: (s.behaviour.length ? s.behaviour : [`Complete "${s.title}"`]).map((b, i) => ({
            action: b,
            inputData: i === 0 ? 'Test record TR-1001' : '',
            expectedBehaviour: 'The system accepts the action.',
            expectedResult: i === s.behaviour.length - 1 ? 'The outcome is saved and visible on the record.' : 'The next step is available.',
          })),
          storyRefs: tech,
          prerequisites: 'UAT environment with test data loaded.',
        };
        const exception = s.alternativeFlows.length
          ? [
              {
                title: `${s.title}: ${lower(s.alternativeFlows[0]!).replace(/\.$/, '')}`,
                scenarioType: 'exception' as const,
                description: s.alternativeFlows[0]!,
                preconditions: ['The tester is signed in with the right role.'],
                steps: [
                  { action: 'Submit the step without the conditional data', inputData: 'Test record TR-1002', expectedBehaviour: 'The system validates the input.', expectedResult: 'The system rejects the submission and names the missing data.' },
                ],
                storyRefs: tech,
                prerequisites: '',
              },
            ]
          : [];
        return [main, ...exception];
      }),
    questions: [],
  };
}

export function refinementForPrompt(prompt: string): Refinement {
  const ctx = readPromptContext<RefinementInput>(prompt);
  const s = ctx?.story;
  if (!s) return { issues: [], refined: { title: '', userRole: '', objective: '', benefit: '', description: '', behaviour: [], alternativeFlows: [], acceptanceCriteria: [] }, questions: [] };
  return {
    issues: [
      ...(s.alternativeFlows.length === 0
        ? [{ severity: 'medium' as const, problem: 'No alternative or exception flows are described.', suggestion: 'Describe what happens when the request is rejected or data is missing.' }]
        : []),
      { severity: 'low' as const, problem: 'The acceptance criteria do not say who can see the result.', suggestion: 'Add a criterion for the audit record.' },
    ],
    refined: {
      title: s.title,
      userRole: s.userRole,
      objective: s.objective,
      benefit: s.benefit,
      description: s.description,
      behaviour: s.behaviour,
      alternativeFlows: s.alternativeFlows.length ? s.alternativeFlows : ['If mandatory data is missing, the system rejects the submission and lists what is missing.'],
      acceptanceCriteria: [...s.acceptanceCriteria, 'Given the step is completed, when the audit log is opened, then it shows who completed it and when.'],
    },
    questions: [],
  };
}

export function impactForPrompt(prompt: string): ChangeImpactAssessment {
  const ctx = readPromptContext<ChangeImpactInput>(prompt);
  if (!ctx) return { summary: '', assessments: [] };
  return {
    summary: `${ctx.changes.length} change${ctx.changes.length === 1 ? '' : 's'} to ${ctx.processName} affect ${ctx.items.length} delivery item${ctx.items.length === 1 ? '' : 's'}.`,
    assessments: ctx.items.map((i) => ({
      ref: i.ref,
      impact: i.reasons.some((r) => r.includes('which changed')) ? ('high' as const) : ('medium' as const),
      recommendation: `Review ${i.ref} against the new process: ${i.reasons[0] ?? 'linked records changed'}.`,
    })),
  };
}

export function improvementsForPrompt(prompt: string): Improvement {
  const ctx = readPromptContext<ImprovementInput>(prompt);
  if (!ctx || ctx.activities.length === 0) return { recommendations: [] };
  const approval = ctx.activities.find((a) => a.type === 'approval' || a.type === 'decision');
  const busiest = [...ctx.activities].sort((a, b) => b.defects + b.failedTests - (a.defects + a.failedTests) || b.inputCount - a.inputCount)[0]!;
  return {
    recommendations: [
      {
        title: `Pre-validate data before "${busiest.label}"`,
        detail: `${busiest.label} captures ${busiest.inputCount} inputs${busiest.defects ? ` and has ${busiest.defects} defects` : ''}. Validating them as they are entered avoids rework later in the process.`,
        activityIds: [busiest.id],
        impact: busiest.defects > 0 ? 'high' : 'medium',
      },
      ...(approval
        ? [
            {
              title: `Auto-approve low-risk cases at "${approval.label}"`,
              detail: 'Cases that meet every eligibility rule could be approved automatically, leaving manual review for exceptions.',
              activityIds: [approval.id],
              impact: 'medium' as const,
            },
          ]
        : []),
    ],
  };
}

/** Picks the fixture answer for a delivery task from the top-level properties of its output schema. */
export function deliveryAnswerFor(properties: Record<string, unknown>, prompt: string): unknown | null {
  if ('technicalStories' in properties) return technicalStoriesForPrompt(prompt);
  if ('stories' in properties) return storiesForPrompt(prompt);
  if ('scenarios' in properties) return scenariosForPrompt(prompt);
  if ('refined' in properties) return refinementForPrompt(prompt);
  if ('assessments' in properties) return impactForPrompt(prompt);
  if ('recommendations' in properties) return improvementsForPrompt(prompt);
  return null;
}
