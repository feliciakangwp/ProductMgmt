import type { ProcessProposal } from '@productflow/domain';
import { env } from './env';
import { AppError } from './errors';
import { supabase } from './supabase';

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AppError('Your session has expired. Sign in again.', 'unauthenticated', 401);

  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new AppError('Could not reach the ProductFlow API. Is it running?', 'network_error');
  }

  const payload = (await response.json().catch(() => null)) as
    (T & { error?: undefined }) | { error?: { code: string; message: string } } | null;
  if (!response.ok) {
    const error = payload && 'error' in payload ? payload.error : undefined;
    throw new AppError(error?.message ?? `Request failed (${response.status}).`, error?.code ?? null, response.status);
  }
  return payload as T;
}

export interface AnalysisResponse {
  runId: string;
  model: string;
  proposal: ProcessProposal;
}

export function analyseProcess(args: { versionId: string; description: string }, signal?: AbortSignal) {
  return postJson<AnalysisResponse>('/api/process-analysis', args, signal);
}
