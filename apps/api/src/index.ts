import { ClaudeProcessAnalyser, createAnthropicMessageFn } from './ai/analyser';
import { loadConfig } from './config';
import { createSupabaseAuthenticator } from './repository';
import { buildServer } from './server';

const config = loadConfig();

const app = buildServer({
  logger: true,
  corsOrigin: config.CORS_ORIGIN.split(',').map((o) => o.trim()),
  authenticator: createSupabaseAuthenticator(config.SUPABASE_URL, config.SUPABASE_ANON_KEY),
  analyser: new ClaudeProcessAnalyser({
    createMessage: createAnthropicMessageFn(config.ANTHROPIC_API_KEY),
    model: config.ANTHROPIC_MODEL,
    effort: config.ANALYSIS_EFFORT,
  }),
});

app.listen({ port: config.PORT, host: config.HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
