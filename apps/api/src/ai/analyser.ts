import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { parseProcessAnalysis, processAnalysisJsonSchema, type ProcessAnalysis } from '@productflow/domain';
import { buildRetryMessage, buildUserMessage, PROMPT_VERSION, SYSTEM_PROMPT } from './prompt';

export interface AnalysisRequest {
  description: string;
  processName: string;
  processType: string;
}

export type AnalysisFailureKind = 'refusal' | 'truncated' | 'invalid_output' | 'rate_limited' | 'unavailable' | 'configuration';

export interface AnalysisUsage {
  inputTokens: number;
  outputTokens: number;
  attempts: number;
}

export type AnalysisOutcome =
  | { ok: true; analysis: ProcessAnalysis; model: string; promptVersion: string; usage: AnalysisUsage }
  | {
      ok: false;
      kind: AnalysisFailureKind;
      message: string;
      model: string;
      promptVersion: string;
      usage: AnalysisUsage;
      rawOutput: string | null;
    };

export interface ProcessAnalyser {
  analyse(request: AnalysisRequest): Promise<AnalysisOutcome>;
}

export type CreateMessage = (params: MessageCreateParamsNonStreaming) => Promise<BetaMessage>;

export interface ClaudeAnalyserOptions {
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

const SCHEMA = processAnalysisJsonSchema();

/**
 * Analyses a process description with Claude using structured outputs, then
 * validates the result against the domain schema. A response that fails
 * validation is retried once with the errors fed back to the model.
 */
export class ClaudeProcessAnalyser implements ProcessAnalyser {
  private readonly createMessage: CreateMessage;
  private readonly model: string;
  private readonly effort: ClaudeAnalyserOptions['effort'];
  private readonly maxRetries: number;

  constructor(options: ClaudeAnalyserOptions) {
    this.createMessage = options.createMessage;
    this.model = options.model;
    this.effort = options.effort;
    this.maxRetries = options.maxRetries ?? 1;
  }

  async analyse(request: AnalysisRequest): Promise<AnalysisOutcome> {
    const original = buildUserMessage(request);
    const usage: AnalysisUsage = { inputTokens: 0, outputTokens: 0, attempts: 0 };
    let servedModel = this.model;
    let userMessage = original;
    let lastOutput: string | null = null;
    let lastErrors: string[] = [];

    const fail = (kind: AnalysisFailureKind, message: string): AnalysisOutcome => ({
      ok: false,
      kind,
      message,
      model: servedModel,
      promptVersion: PROMPT_VERSION,
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
            format: { type: 'json_schema', schema: SCHEMA },
          },
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        });
      } catch (err) {
        return fail(...classifyApiError(err));
      }

      servedModel = response.model;
      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;

      if (response.stop_reason === 'refusal') {
        return fail('refusal', 'Claude declined to analyse this description. Review the text and try again.');
      }
      const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
      lastOutput = text;
      if (response.stop_reason === 'max_tokens') {
        return fail('truncated', 'The process description is too long to analyse in one pass. Split it into smaller processes.');
      }

      const parsed = parseProcessAnalysis(text);
      if (parsed.ok) {
        return { ok: true, analysis: parsed.value, model: servedModel, promptVersion: PROMPT_VERSION, usage };
      }
      lastErrors = parsed.errors;
      userMessage = buildRetryMessage({ original, invalidOutput: text, errors: parsed.errors });
    }

    return fail(
      'invalid_output',
      `Claude returned a process model that failed validation (${lastErrors.slice(0, 3).join('; ')}). Try again.`,
    );
  }
}

function classifyApiError(err: unknown): [AnalysisFailureKind, string] {
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
