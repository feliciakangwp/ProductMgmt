import { createClient } from '@supabase/supabase-js';
import { env, isConfigured } from './env';

/**
 * Browser Supabase client. It only holds the public anon key; every query
 * runs under the signed-in user's row level security policies.
 */
export const supabase = createClient(
  isConfigured ? env.supabaseUrl : 'http://localhost.invalid',
  isConfigured ? env.supabaseAnonKey : 'missing',
  { auth: { persistSession: true, autoRefreshToken: true } },
);
