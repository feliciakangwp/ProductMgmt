import Anthropic from '@anthropic-ai/sdk';
import { buildRetryMessage, type ParseResult } from '@productflow/domain';
import {
  DEBT_WRITE_OFF_ANALYSIS,
  deliveryAnswerFor,
  fieldSuggestionsForPrompt,
  OUTSTANDING_AMOUNT_TRANSLATION,
} from '@productflow/domain/testing';
import { AppError } from '../errors';

/**
 * How the in-browser demo reaches Claude. There is no server, so:
 *
 * - On claude.ai, the demo uses the Claude artifact runtime, on the viewer's own account.
 * - Elsewhere (for example GitHub Pages), a viewer can paste their own Anthropic API key.
 *   It is kept only in this browser tab's session storage and sent only to api.anthropic.com.
 *   The production app never does this: its key lives on the API server.
 * - Otherwise the demo answers with built-in sample responses, clearly labelled, so every
 *   screen can still be tried.
 */

export type DemoAiMode = 'claude_runtime' | 'own_key' | 'samples';

const KEY_STORAGE = 'productflow-demo:anthropic-key';
const MODEL = 'claude-opus-5-5';

interface SampleError {
  code: string;
  message: string;
}
type SampleJson = (
  input: string,
  options?: { modelTier?: 'default' | 'complex' | 'quick'; signal?: AbortSignal },
) => Promise<unknown>;
interface ClaudeRuntime {
  use(name: 'sample'): Promise<{ json: SampleJson } | null>;
}

let runtimeSample: Promise<SampleJson | null> | null = null;
function claudeRuntime(): Promise<SampleJson | null> {
  runtimeSample ??= (async () => {
    const runtime = (globalThis as { claude?: ClaudeRuntime }).claude;
    if (!runtime) return null;
    try {
      return (await runtime.use('sample'))?.json ?? null;
    } catch {
      return null;
    }
  })();
  return runtimeSample;
}

function sessionKey(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(KEY_STORAGE) ?? null;
  } catch {
    return null;
  }
}

export const demoAi = {
  async mode(): Promise<DemoAiMode> {
    if (await claudeRuntime()) return 'claude_runtime';
    return sessionKey() ? 'own_key' : 'samples';
  },
  hasRuntime: async () => (await claudeRuntime()) !== null,
  setKey(key: string | null) {
    try {
      if (key?.trim()) globalThis.sessionStorage.setItem(KEY_STORAGE, key.trim());
      else globalThis.sessionStorage.removeItem(KEY_STORAGE);
    } catch {
      /* storage unavailable: the key is not kept */
    }
  },
  hasKey: () => sessionKey() !== null,
};

export const MODEL_LABELS: Record<DemoAiMode, string> = {
  claude_runtime: 'Claude (your claude.ai account)',
  own_key: `${MODEL} (your API key)`,
  samples: 'Sample responses (offline demo)',
};

function runtimeErrorMessage(error: SampleError): string {
  switch (error.code) {
    case 'not_granted':
    case 'sampling_disabled':
      return 'This page is not allowed to use Claude. Allow it in the artifact permissions and try again.';
    case 'rate_limited':
      return 'Claude is busy or your usage limit was reached. Wait a moment and try again.';
    case 'session_expired':
      return 'Your claude.ai session expired. Sign in again and reload the page.';
    case 'refused':
      return 'Claude declined this request. Review the text and try again.';
    case 'prompt_too_large':
      return 'The request is too large to answer in one pass. Ask for less at a time.';
    default:
      return 'Claude could not complete the request. Try again in a moment.';
  }
}

/** The built-in sample answer for a task, chosen from its output schema like the test mock does. */
function sampleAnswer(schema: Record<string, unknown>, user: string): unknown {
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  const delivery = deliveryAnswerFor(properties, user);
  if (delivery) return delivery;
  if ('activities' in properties) return fieldSuggestionsForPrompt(user);
  if ('rules' in properties) return OUTSTANDING_AMOUNT_TRANSLATION;
  return DEBT_WRITE_OFF_ANALYSIS;
}

async function askOwnKey(
  key: string,
  args: { system: string; user: string; schema: Record<string, unknown> },
  signal?: AbortSignal,
) {
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  try {
    const response = await client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: args.schema } },
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
      },
      { signal },
    );
    if (response.stop_reason === 'refusal')
      throw new AppError('Claude declined this request. Review the text and try again.', 'ai_refusal');
    if (response.stop_reason === 'max_tokens')
      throw new AppError('The request is too large to answer in one pass. Ask for less at a time.', 'ai_truncated');
    return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Anthropic.APIUserAbortError) throw new AppError('Cancelled.', 'cancelled');
    if (err instanceof Anthropic.AuthenticationError)
      throw new AppError('Anthropic rejected the API key. Check it in AI settings.', 'ai_configuration');
    if (err instanceof Anthropic.RateLimitError)
      throw new AppError('The AI service is busy. Wait a minute and try again.', 'ai_rate_limited');
    if (err instanceof Anthropic.APIError)
      throw new AppError(`The AI service returned an error (${err.status ?? 'network'}). Try again.`, 'ai_unavailable');
    throw new AppError('Could not reach the AI service. Try again.', 'ai_unavailable');
  }
}

/** Asks Claude (or the samples) for structured JSON, validates it, and retries once with the validation errors. */
export async function runStructured<T>(args: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  parse: (raw: string) => ParseResult<T>;
  signal?: AbortSignal;
}): Promise<{ value: T; model: string }> {
  const mode = await demoAi.mode();
  let message = args.user;
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    if (mode === 'samples') {
      await new Promise((r) => setTimeout(r, 400));
      raw = JSON.stringify(sampleAnswer(args.schema, args.user));
    } else if (mode === 'own_key') {
      raw = await askOwnKey(sessionKey()!, { system: args.system, user: message, schema: args.schema }, args.signal);
    } else {
      const json = (await claudeRuntime())!;
      const format = `\n\nReply with only a JSON object that matches this JSON schema exactly (no other text):\n${JSON.stringify(args.schema)}`;
      try {
        raw = JSON.stringify(await json(`${args.system}\n\n${message}${format}`, { modelTier: 'default', signal: args.signal }));
      } catch (err) {
        const error = err as SampleError;
        if (error?.code === 'cancelled') throw new AppError('Cancelled.', 'cancelled');
        throw new AppError(runtimeErrorMessage(error), `ai_${error?.code ?? 'error'}`);
      }
    }
    const parsed = args.parse(raw);
    if (parsed.ok) return { value: parsed.value, model: MODEL_LABELS[mode] };
    lastErrors = parsed.errors;
    message = buildRetryMessage({ original: args.user, invalidOutput: raw, errors: parsed.errors });
  }
  throw new AppError(
    `Claude returned an answer that failed validation (${lastErrors.slice(0, 3).join('; ')}). Try again.`,
    'ai_invalid_output',
  );
}
