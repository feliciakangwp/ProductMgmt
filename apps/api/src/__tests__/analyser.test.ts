import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { DEBT_WRITE_OFF_ANALYSIS } from '@productflow/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeProcessAnalyser } from '../ai/analyser';
import { PROMPT_VERSION } from '../ai/prompt';

function message(text: string, overrides: Partial<BetaMessage> = {}): BetaMessage {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text, citations: null },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
    ...overrides,
  } as unknown as BetaMessage;
}

const request = {
  description: 'When a Finance Officer receives a request...',
  processName: 'Debt write-off',
  processType: 'to_be',
};

function analyser(createMessage: (p: MessageCreateParamsNonStreaming) => Promise<BetaMessage>) {
  return new ClaudeProcessAnalyser({ createMessage, model: 'claude-opus-5-5', effort: 'medium' });
}

describe('ClaudeProcessAnalyser', () => {
  it('sends a structured-output request and returns the validated analysis', async () => {
    const create = vi.fn(async (_params: MessageCreateParamsNonStreaming) => message(JSON.stringify(DEBT_WRITE_OFF_ANALYSIS)));
    const outcome = await analyser(create).analyse(request);

    expect(outcome).toMatchObject({ ok: true, model: 'claude-opus-5-5', promptVersion: PROMPT_VERSION });
    if (outcome.ok) expect(outcome.analysis.steps).toHaveLength(8);
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0]![0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.output_config?.format?.type).toBe('json_schema');
    expect(params.output_config?.effort).toBe('medium');
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params).not.toHaveProperty('thinking');
    const content = params.messages[0]!.content as string;
    expect(content).toContain('<process_description>\nWhen a Finance Officer receives a request...\n</process_description>');
    expect(content).toContain('To-Be');
  });

  it('retries once with validation errors and succeeds', async () => {
    const broken = { ...DEBT_WRITE_OFF_ANALYSIS, flows: [{ from: 'S1', to: 'S404', branch: null, label: '', condition: '' }] };
    const create = vi
      .fn()
      .mockResolvedValueOnce(message(JSON.stringify(broken)))
      .mockResolvedValueOnce(message(JSON.stringify(DEBT_WRITE_OFF_ANALYSIS)));
    const outcome = await analyser(create).analyse(request);
    expect(outcome.ok).toBe(true);
    expect(outcome.usage).toEqual({ inputTokens: 200, outputTokens: 100, attempts: 2 });
    const retry = create.mock.calls[1]![0] as MessageCreateParamsNonStreaming;
    expect(retry.messages).toHaveLength(1);
    expect(retry.messages[0]!.content).toContain('flows.0.to: unknown step id "S404"');
  });

  it('fails with invalid_output after the retry also fails', async () => {
    const create = vi.fn(async () => message('not json'));
    const outcome = await analyser(create).analyse(request);
    expect(outcome).toMatchObject({ ok: false, kind: 'invalid_output', rawOutput: 'not json' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('reports refusals without retrying', async () => {
    const create = vi.fn(async () => message('', { stop_reason: 'refusal' }));
    const outcome = await analyser(create).analyse(request);
    expect(outcome).toMatchObject({ ok: false, kind: 'refusal' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('reports truncated output', async () => {
    const create = vi.fn(async () => message('{"processName":', { stop_reason: 'max_tokens' }));
    expect(await analyser(create).analyse(request)).toMatchObject({ ok: false, kind: 'truncated' });
  });

  it('records the model that actually served the request', async () => {
    const create = vi.fn(async () => message(JSON.stringify(DEBT_WRITE_OFF_ANALYSIS), { model: 'claude-opus-5' }));
    expect(await analyser(create).analyse(request)).toMatchObject({ ok: true, model: 'claude-opus-5' });
  });

  it('maps API errors to failure kinds', async () => {
    const rateLimited = vi.fn(async () => {
      throw new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers());
    });
    expect(await analyser(rateLimited).analyse(request)).toMatchObject({ ok: false, kind: 'rate_limited' });

    const badKey = vi.fn(async () => {
      throw new Anthropic.AuthenticationError(401, { type: 'error' }, 'bad key', new Headers());
    });
    expect(await analyser(badKey).analyse(request)).toMatchObject({ ok: false, kind: 'configuration' });

    const offline = vi.fn(async () => {
      throw new Anthropic.APIConnectionError({ message: 'offline' });
    });
    expect(await analyser(offline).analyse(request)).toMatchObject({ ok: false, kind: 'unavailable' });
  });

  it('rethrows programming errors', async () => {
    const create = vi.fn(async () => {
      throw new TypeError('boom');
    });
    await expect(analyser(create).analyse(request)).rejects.toThrow('boom');
  });
});
