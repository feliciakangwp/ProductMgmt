# Local development setup

## Prerequisites

- Node.js 20 or later (22 recommended, see `.nvmrc`)
- One of:
  - **Supabase CLI** with Docker (recommended), or
  - PostgreSQL 15+ server binaries, to use the Docker-free stack in `e2e/stack/` (Linux x86-64)
- An Anthropic API key, for the "Analyse & Generate Process Map" feature

## 1. Install dependencies

```bash
npm install
```

## 2. Start Supabase

### Option A: Supabase CLI (recommended)

```bash
npx supabase start          # starts Postgres, Auth and the REST API; applies supabase/migrations
npx supabase status         # shows the API URL and the anon key
```

To re-apply migrations from scratch: `npx supabase db reset`.

### Option B: without Docker

```bash
bash e2e/stack/start.sh     # downloads PostgREST and GoTrue on first run, applies migrations
cat e2e/.stack/env          # SUPABASE_URL and SUPABASE_ANON_KEY
bash e2e/stack/stop.sh
```

This stack is for development and tests only. Email confirmation is off and the JWT secret is a fixed
development value.

### Option C: a hosted Supabase project

Apply the SQL files in `supabase/migrations/` in order (`npx supabase db push` with a linked project, or paste
them into the SQL editor). Use the project's URL and anon key below. For a shared environment, keep email
confirmation on and set the Site URL to where the web app is served.

## 3. Configure the apps

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

| File                  | Setting                                       | Value                                                                              |
| --------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/web/.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | From step 2                                                                        |
| `apps/api/.env`       | `SUPABASE_URL`, `SUPABASE_ANON_KEY`           | Same values                                                                        |
| `apps/api/.env`       | `ANTHROPIC_API_KEY`                           | Your Anthropic API key. Only the API server reads it; it never reaches the browser |
| `apps/api/.env`       | `ANTHROPIC_MODEL`, `ANALYSIS_EFFORT`          | Optional; defaults `claude-opus-5-5` and `medium`                                  |

The service-role key is not needed by either app.

## 4. Run

```bash
npm run dev                 # API on :8787 and web app on :5173 (Vite proxies /api to the API)
```

Open http://localhost:5173, create an account, create a project and a process, describe it, and click
**Analyse & Generate Process Map**.

To invite colleagues: they create an account first, then a project Administrator adds them by email under
**Projects → Members** with a role.

## 5. Tests

| Command             | What it runs                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `npm test`          | Unit tests: domain logic, API (Claude client and routes with fakes), web reducer and mappings |
| `npm run test:db`   | SQL tests for RLS, roles, versioning and workflow functions against a throwaway PostgreSQL    |
| `npm run test:e2e`  | Playwright end-to-end tests. Start the stack first: `bash e2e/stack/start.sh`                 |
| `npm run typecheck` | TypeScript in every workspace                                                                 |
| `npm run lint`      | Prettier formatting check                                                                     |

`test:db` and the Docker-free stack look for PostgreSQL binaries on `PATH` or in `/usr/lib/postgresql/*/bin`;
set `PG_BIN` to override. The end-to-end tests run the real web app, API and database, with a local mock in
place of the Anthropic API so they need no API key. If Playwright cannot find its browser, run
`npx playwright install chromium` or set `CHROMIUM_PATH`.

## Troubleshooting

- **"Configuration needed" page:** `apps/web/.env.local` is missing or the dev server was not restarted.
- **"Could not reach the ProductFlow API":** the API is not running or failed to start. Check its console for
  configuration errors.
- **"The AI service rejected the server credentials":** check `ANTHROPIC_API_KEY` in `apps/api/.env`.
- **"No user with email … has signed up yet":** the person must create an account before being added to a project.
