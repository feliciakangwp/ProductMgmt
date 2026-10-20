# ProductFlow AI

An AI-powered product management and delivery platform. Business Analysts describe business processes in plain
language; Claude drafts an interactive process map that the analyst reviews, edits, validates and approves.
Later phases build data requirements, user stories, delivery tracking and UAT on the same traceable model.

**Status: Phase 1 (Process Design)** is implemented. Other modules are visible in the navigation as Coming Soon.

## What Phase 1 does

- Projects with role-based access (Administrator, Product Owner, Business Analyst, Developer, Business User),
  enforced by Postgres row level security
- Processes (As-Is / To-Be, owner, business unit) with a natural-language description editor
- **Analyse & Generate Process Map**: Claude identifies the start and end, activities, actors, decisions,
  approvals, system steps, business rules, exceptions and missing information. You review the result before it
  enters the draft; inferred steps and findings are labelled
- Interactive map: add, delete, rename and retype steps; connect and reconnect; edit conditions and actors;
  drag and drop; automatic layout; undo and redo
- Validation: missing start/end, disconnected or unreachable steps, decisions without outcomes, missing actors,
  ambiguous wording and open questions
- Versioning: save drafts with conflict detection and crash recovery. Approved versions are frozen, and changes
  go into a new draft

## Repository

| Path              | Contents                                                        |
| ----------------- | --------------------------------------------------------------- |
| `apps/web`        | React + TypeScript + Vite + Tailwind web app                    |
| `apps/api`        | Node + Fastify API holding the Anthropic key                    |
| `packages/domain` | Shared domain model, schemas and logic                          |
| `supabase`        | Database migrations and SQL tests                               |
| `e2e`             | Playwright tests and a Docker-free local stack                  |
| `docs`            | [Architecture](docs/ARCHITECTURE.md) and [setup](docs/SETUP.md) |

## Quick start

```bash
npm install
npx supabase start                      # or: bash e2e/stack/start.sh (no Docker)
cp apps/web/.env.example apps/web/.env.local   # fill in Supabase URL and anon key
cp apps/api/.env.example apps/api/.env         # same, plus ANTHROPIC_API_KEY
npm run dev                             # http://localhost:5173
```

See [docs/SETUP.md](docs/SETUP.md) for details and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.
