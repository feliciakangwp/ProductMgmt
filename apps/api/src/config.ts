import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('127.0.0.1'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  ANALYSIS_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
});

export type Config = z.infer<typeof EnvSchema>;

/** Reads and validates server configuration. Secrets live only in the API's environment. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid API configuration. Check apps/api/.env:\n${problems}`);
  }
  return result.data;
}
