import { resolve } from 'node:path';
import { ClaudeProcessAnalyser, ClaudeStructuredRunner, createAnthropicMessageFn } from './ai/analyser';
import { loadConfig } from './config';
import { createServiceClient, createSupabaseDeliveryStore } from './delivery';
import { createSupabaseAuthenticator } from './repository';
import { buildServer } from './server';

const config = loadConfig();

const runner = new ClaudeStructuredRunner({
  createMessage: createAnthropicMessageFn(config.ANTHROPIC_API_KEY),
  model: config.ANTHROPIC_MODEL,
  effort: config.ANALYSIS_EFFORT,
});

const app = buildServer({
  runner,
  logger: true,
  corsOrigin: config.CORS_ORIGIN.split(',').map((o) => o.trim()),
  authenticator: createSupabaseAuthenticator(config.SUPABASE_URL, config.SUPABASE_ANON_KEY),
  analyser: new ClaudeProcessAnalyser({ runner }),
  webRoot: config.WEB_ROOT ? resolve(config.WEB_ROOT) : undefined,
  deliveryStore: config.SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseDeliveryStore(createServiceClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY))
    : undefined,
});

app.listen({ port: config.PORT, host: config.HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
