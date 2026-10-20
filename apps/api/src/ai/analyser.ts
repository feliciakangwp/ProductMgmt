import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  buildRetryMessage,
  buildUserMessage,
  parseProcessAnalysis,
  processAnalysisJsonSchema,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  type ParseResult,
  type ProcessAnalysis,
} from '@productflow/domain';

export type AiFailureKind = 'refusal' | 'truncated' | 'invalid_output' | 'rate_limited' | 'unavailable' | 'configuration';

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  attempts: number;
}

export type StructuredOutcome<T> =
  | { ok: true; value: T; model: string; promptVersion: string; usage: AiUsage }
  | {
      ok: false;
      kind: AiFailureKind;
      message: string;
      model: string;
      promptVersion: string;
      usage: AiUsage;
      rawOutput: string | null;
    };

/** One structured-output request to Claude: prompts, the JSON schema it must follow, and a validator. */
export interface StructuredTask<T> {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  parse: (raw: string) => ParseResult<T>;
  promptVersion: string;
}

export interface StructuredRunner {
  run<T>(task: StructuredTask<T>): Promise<StructuredOutcome<T>>;
}

export type CreateMessage = (params: MessageCreateParamsNonStreaming) => Promise<BetaMessage>;

export interface ClaudeRunnerOptions {
  createMessage: CreateMessage;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Extra attempts after a response that fails validation. */
  maxRetries?: number;
}

export function createAnthropicMessageFn(apiKey: string): CreateMessage {
  const client = new Anthropic({ apiKey });
  return (params) => client.beta.messages.create(params);
}

/**
 * Runs a structured task on Claude: structured outputs constrain the reply to
 * the task's JSON schema, the reply is validated again with the task's
 * parser, and a reply that fails validation is retried once with the errors
 * fed back to the model.
 */
export class ClaudeStructuredRunner implements StructuredRunner {
  private readonly createMessage: CreateMessage;
  private readonly model: string;
  private readonly effort: ClaudeRunnerOptions['effort'];
  private readonly maxRetries: number;

  constructor(options: ClaudeRunnerOptions) {
    this.createMessage = options.createMessage;
    this.model = options.model;
    this.effort = options.effort;
    this.maxRetries = options.maxRetries ?? 1;
  }

  async run<T>(task: StructuredTask<T>): Promise<StructuredOutcome<T>> {
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0, attempts: 0 };
    let servedModel = this.model;
    let userMessage = task.user;
    let lastOutput: string | null = null;
    let lastErrors: string[] = [];

    const fail = (kind: AiFailureKind, message: string): StructuredOutcome<T> => ({
      ok: false,
      kind,
      message,
      model: servedModel,
      promptVersion: task.promptVersion,
      usage,
      rawOutput: lastOutput,
    });

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response: BetaMessage;
      try {
        usage.attempts++;
        response = await this.createMessage({
          model: this.model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: {
            effort: this.effort,
            format: { type: 'json_schema', schema: task.schema },
          },
          system: task.system,
          messages: [{ role: 'user', content: userMessage }],
        });
      } catch (err) {
        return fail(...classifyApiError(err));
      }

      servedModel = response.model;
      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;

      if (response.stop_reason === 'refusal') {
        return fail('refusal', 'Claude declined this request. Review the text and try again.');
      }
      const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
      lastOutput = text;
      if (response.stop_reason === 'max_tokens') {
        return fail('truncated', 'The request is too large to answer in one pass. Ask for less at a time.');
      }

      const parsed = task.parse(text);
      if (parsed.ok) {
        return { ok: true, value: parsed.value, model: servedModel, promptVersion: task.promptVersion, usage };
      }
      lastErrors = parsed.errors;
      userMessage = buildRetryMessage({ original: task.user, invalidOutput: text, errors: parsed.errors });
    }

    return fail(
      'invalid_output',
      `Claude returned an answer that failed validation (${lastErrors.slice(0, 3).join('; ')}). Try again.`,
    );
  }
}

export interface AnalysisRequest {
  description: string;
  processName: string;
  processType: string;
}

export type AnalysisOutcome =
  | { ok: true; analysis: ProcessAnalysis; model: string; promptVersion: string; usage: AiUsage }
  | Extract<StructuredOutcome<ProcessAnalysis>, { ok: false }>;

export interface ProcessAnalyser {
  analyse(request: AnalysisRequest): Promise<AnalysisOutcome>;
}

const PROCESS_SCHEMA = processAnalysisJsonSchema();

/** Process analysis (Phase 1) as a structured task. */
export class ClaudeProcessAnalyser implements ProcessAnalyser {
  private readonly runner: StructuredRunner;

  constructor(options: ClaudeRunnerOptions | { runner: StructuredRunner }) {
    this.runner = 'runner' in options ? options.runner : new ClaudeStructuredRunner(options);
  }

  async analyse(request: AnalysisRequest): Promise<AnalysisOutcome> {
    const outcome = await this.runner.run({
      system: SYSTEM_PROMPT,
      user: buildUserMessage(request),
      schema: PROCESS_SCHEMA,
      parse: parseProcessAnalysis,
      promptVersion: PROMPT_VERSION,
    });
    if (!outcome.ok) {
      return outcome.kind === 'refusal'
        ? { ...outcome, message: 'Claude declined to analyse this description. Review the text and try again.' }
        : outcome.kind === 'truncated'
          ? {
              ...outcome,
              message: 'The process description is too long to analyse in one pass. Split it into smaller processes.',
            }
          : outcome.kind === 'invalid_output'
            ? { ...outcome, message: outcome.message.replace('an answer', 'a process model') }
            : outcome;
    }
    const { value, ...rest } = outcome;
    return { ...rest, analysis: value };
  }
}

function classifyApiError(err: unknown): [AiFailureKind, string] {
  if (err instanceof Anthropic.RateLimitError) {
    return ['rate_limited', 'The AI service is busy. Wait a minute and try again.'];
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return ['configuration', 'The AI service rejected the server credentials. Check ANTHROPIC_API_KEY.'];
  }
  if (err instanceof Anthropic.BadRequestError) {
    return ['configuration', `The AI service rejected the request: ${err.message}`];
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return ['unavailable', 'Could not reach the AI service. Check the network connection and try again.'];
  }
  if (err instanceof Anthropic.APIError) {
    return ['unavailable', `The AI service returned an error (${err.status ?? 'unknown'}). Try again shortly.`];
  }
  throw err;
}
