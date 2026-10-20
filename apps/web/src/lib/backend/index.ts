// `@backend` resolves to supabase.ts, or to demo.ts in the demo build (see vite.config.ts).
import { createBackend } from '@backend';
import type { Backend } from './types';

export const backend: Backend = createBackend();
export * from './types';
