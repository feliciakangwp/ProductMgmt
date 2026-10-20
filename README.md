# ProductFlow AI

An AI-powered product management and delivery platform. Business Analysts describe business processes in plain
language; Claude drafts an interactive process map that the analyst reviews, edits, validates and approves.
Data requirements, user stories, delivery tracking, UAT and analytics are built on the same traceable model.

**Status: Phases 1 to 7 are implemented.** Try the demo (no account needed) on GitHub Pages once Pages is enabled for
the repository, see [docs/SETUP.md](docs/SETUP.md#6-deploy-the-demo-to-github-pages).

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

## What Phase 2 does

- **Input & Output Designer**: for each activity, the input and output fields (mandatory, optional or conditional with
  the condition), records updated, documents generated, notifications and status changes, and the next activity from the map
- **AI suggestions**: Claude proposes fields and outputs from the process; you tick what to keep, new fields start as drafts
- **Data dictionary**: reusable logical fields with types, sources and defaults, mapped many-to-many to physical columns,
  with "used by" traceability across process versions
- **Validation rules** per field (required, format, range, length, conditional, cross-field, lookup, duplicate, custom),
  written by hand or translated by Claude from plain language and confirmed by the analyst
- **Business rule register** with Product Owner approval, links to activities and validation rules, and import of the
  rules AI found in process descriptions

## What Phases 3 to 7 do

- **User stories:** Claude drafts functional stories from approved processes and technical stories from functional ones;
  analysts and developers edit, link them to activities, fields and rules, and submit them for Product Owner approval.
  AI technical designs are labelled Proposed until a developer confirms them. Only approved stories enter the backlog
- **Backlog, sprints and Kanban:** prioritise and estimate, plan sprints against capacity, and move work through six
  columns with tracked transitions, effort, blocking and comments
- **UAT:** business scenarios become Ready for UAT once their technical stories are completed; testers run them step
  by step and raise defects from failed steps with screenshots. Test history is never overwritten
- **Defects, dashboard, insights:** the defect lifecycle; velocity (points and hours, separately), burndown, workload,
  cycle time and UAT progress from stored data; consistency checks, AI change-impact analysis and improvement
  recommendations; end-to-end traceability from an activity to its tests and defects

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
