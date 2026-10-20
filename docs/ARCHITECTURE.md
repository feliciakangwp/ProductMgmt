# ProductFlow AI: Architecture

ProductFlow AI is an AI-assisted product management and delivery platform. It connects business process
design, data requirements, user stories, delivery and UAT through one structured, traceable requirements
model. This document describes the overall architecture, the data model, how modules depend on each other,
and what Phase 1 (Process Design) delivers.

## 1. System overview

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│  apps/web  (React + Vite)  │  JWT   │  apps/api  (Node + Fastify)  │
│  Tailwind, React Flow,     ├───────►│  • Claude process analysis   │
│  Dagre, React Router,      │ /api/* │  • Response validation (zod) │
│  TanStack Query            │        │  • Role + version checks     │
└──────────┬─────────────────┘        │  • Holds ANTHROPIC_API_KEY   │
           │ supabase-js              └──────────────┬───────────────┘
           │ (user JWT, RLS applies)                 │ supabase-js (the *user's* JWT,
           ▼                                         ▼  never the service-role key)
┌────────────────────────────────────────────────────────────────────┐
│  Supabase: PostgreSQL + Auth + Row Level Security                  │
│  • Tables with RLS by project membership and role                  │
│  • SECURITY DEFINER RPCs for workflow writes (create, save,        │
│    approve, new draft, membership)                                 │
│  • Triggers: frozen approved versions, audit log, ref codes        │
└────────────────────────────────────────────────────────────────────┘
        ▲
        │ shared by every app and the tests
┌───────┴──────────────────────────────────────────────┐
│ packages/domain: types, zod schemas, and pure logic  │
│ (AI→graph mapping, validation, layout, graph edits,  │
│ DB row mapping)                                      │
└──────────────────────────────────────────────────────┘
```

**Principles in the implementation**

| Principle                    | How it is enforced                                                                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single source of truth       | One relational model in Postgres; `packages/domain` is the only definition of its TypeScript shape. React Flow only renders a projection of the domain graph.                                                                          |
| Security in the database     | RLS on every table; workflow writes are only possible through RPCs that check the caller's project role. The API calls Supabase with the user's own JWT, so it cannot bypass RLS. The UI hides controls only for usability.            |
| Human-in-the-loop AI         | Claude's output is schema-validated and shown as a proposal. Nothing is stored until a Business Analyst accepts it into a draft and saves. Inferred steps and findings are labelled; findings stay Draft until accepted or dismissed.  |
| Traceable, versioned changes | Approved versions are frozen by triggers; changes create a new draft version. Every element has a lineage `element_key` and a human-readable ref code that survive versioning. Saves use optimistic locking; changes are audit-logged. |

## 2. Data model

### Identity and access (Phase 1)

| Table             | Purpose                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `profiles`        | Display name and email, created by trigger for each `auth.users` row                                      |
| `projects`        | `key` (e.g. `DWO`), name, description                                                                     |
| `project_members` | `(project_id, user_id, role)`: `admin`, `product_owner`, `business_analyst`, `developer`, `business_user` |
| `id_counters`     | Per-project sequences behind ref codes such as `PRC-001`, `ACT-014`, `DEC-003`                            |
| `audit_log`       | Row changes and draft saves: who, when, before/after                                                      |

### Process design (Phase 1)

| Table                   | Key columns                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actors`                | Project-level roles, systems and external parties, reused across processes                                                                           |
| `processes`             | Ref code, name, As-Is/To-Be, owner, business unit                                                                                                    |
| `process_versions`      | Version number, status (`draft` / `approved` / `superseded`), description, `revision` (optimistic locking), approval metadata, `based_on_version_id` |
| `process_nodes`         | `element_key` (lineage), ref code, type (start/end/activity/decision/approval/system), label, description, actor, position, origin, source text      |
| `process_edges`         | `element_key`, source/target node keys, label, condition, branch (yes/no/other)                                                                      |
| `process_findings`      | AI or analyst findings: business rules, exceptions, missing information, ambiguities, with status and links to nodes                                 |
| `process_analysis_runs` | Every Claude call: model, prompt version, description snapshot, raw response, error, token usage, when accepted                                      |

Nodes and edges are rows rather than a JSON blob because later modules must reference individual activities
with foreign keys and RLS. Edges reference nodes by `(version_id, element_key)`, so copying a version into a new
draft copies rows without remapping ids.

**Lineage.** "Submit Write-Off Request" in version 1 and version 2 are different rows that share one
`element_key` and one ref code. Links from later modules follow an activity across versions, and Phase 7's
change-impact analysis can compare versions element by element.

### Planned tables (later phases)

| Phase | Tables                                                                                                                                                                                               |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | `field_definitions` (data dictionary of logical fields), `activity_fields` (activity ↔ field, input/output, mandatory condition), `validation_rules`, `business_rules`, `physical_columns` + mapping |
| 3     | `stories` (functional/technical, versioned), `story_activities`, `story_fields`, `story_rules`, `story_dependencies`                                                                                 |
| 4     | `sprints`, `sprint_items` (a story keeps its backlog record), `status_transitions`, `effort_logs`                                                                                                    |
| 5–6   | `business_scenarios`, `scenario_steps`, `scenario_tech_stories`, `test_executions` (append-only), `step_results`, `defects`, `defect_links`                                                          |

Accepted `business_rule` findings from Phase 1 become the seed of the Phase 2 `business_rules` register.

**Traceability.** Each relationship gets its own typed link table so the database enforces integrity; a
`trace_graph` view will union them into `(source_type, source_id, target_type, target_id)` rows, so "select an
activity and see everything linked to it" becomes one recursive query.

## 3. Versioning and workflow rules

- Each process has at most one draft (partial unique index) and any number of approved/superseded versions.
- Only drafts can change. Triggers reject any change to the nodes, edges or findings of a non-draft version,
  and any change to a frozen version row except `approved → superseded`.
- **Save:** `save_process_draft(version, expected_revision, description, nodes, edges, findings, run)` upserts the
  whole draft in one transaction. A stale `expected_revision` fails with `PF409`; the UI offers to reload.
- **Approve:** Product Owner or Admin. `approve_process_version` re-checks the revision and blocking structural
  rules in SQL (one start, an end, every decision has two outcomes, every node reachable) whatever client
  calls it. The UI requires warnings to be acknowledged. The previous approved version becomes superseded.
- **Change an approved process:** `create_draft_from_version` copies it into version _n+1_ keeping element keys
  and ref codes.

Error codes raised by database functions: `PF409` conflict, `PF422` invalid, `PF423` locked version,
`42501` permission denied, `P0002` not found.

## 4. Permissions (Phase 1)

| Action                                 | Admin | Product Owner | Business Analyst | Developer | Business User |
| -------------------------------------- | :---: | :-----------: | :--------------: | :-------: | :-----------: |
| Read project processes                 |   ✓   |       ✓       |        ✓         |     ✓     |       ✓       |
| Create/edit processes, run AI analysis |   ✓   |               |        ✓         |           |               |
| Approve a process version              |   ✓   |       ✓       |                  |           |               |
| Manage members, rename project         |   ✓   |               |                  |           |               |
| Read audit log                         |   ✓   |       ✓       |                  |           |               |

The same matrix lives in `packages/domain/src/roles.ts` (UI) and in the RLS policies and RPC checks (enforcement).

## 5. Claude integration

1. `POST /api/process-analysis` with `{ versionId, description }`. The API verifies the Supabase session,
   loads the version under the user's RLS, and checks the role (BA/Admin) and that the version is a draft.
2. The API calls the Messages API with structured outputs (`output_config.format` = the JSON schema generated
   from the zod schema in `packages/domain/src/process/ai-schema.ts`) and server-side refusal fallback.
3. The reply is validated with zod plus reference checks (unique step ids, flows and findings pointing at real
   steps). If invalid, the API retries once, feeding the errors back.
4. `analysisToProposal` assigns lineage keys and lays the graph out with Dagre. The run is recorded.
5. The web app shows the proposal; on accept, missing actors are created and the map enters the draft editor
   unsaved, and undoable.

The prompt (`apps/api/src/ai/prompt.ts`) instructs Claude to build the model only from the description, mark
anything else as inferred, record gaps as questions, and treat the description as data rather than instructions.
`ANTHROPIC_MODEL` and `ANALYSIS_EFFORT` are configurable.

## 6. Module dependencies

```
Projects/Auth ─► Process Designer ─► I/O Designer ─► Tech User Story ─► Backlog ─► Sprint ─► Kanban
                        │                 │                 │                                   │
                        └─────────────────┴─► Business User Story ◄──────(completion status)───┘
                                                    │
                                                    ▼
                                    Business Testing ─► Defects ─► Dashboard
```

Everything downstream links to `process_nodes.element_key` (and a version), so that column and the versioning
rules are the parts Phase 1 had to get right.

## 7. Repository layout

```
apps/
  web/        React app (src/app shell, components/ui, modules/<module>, lib)
  api/        Fastify API (routes in server.ts, ai/ for Claude, repository.ts for data access)
packages/
  domain/     Shared types, schemas and pure logic, with unit tests
supabase/
  migrations/ SQL: tables, RLS, functions, triggers
  tests/      SQL tests run against a throwaway PostgreSQL (run.sh)
e2e/
  stack/      Docker-free local Supabase-compatible stack + mock Anthropic API
  tests/      Playwright end-to-end tests
docs/         This document and the setup guide
```

## 8. Phase 1 scope

Delivered: application shell and navigation (future modules marked Coming Soon), authentication, projects and
member roles, process creation and description editing, Claude analysis with review-before-accept, interactive
React Flow map (start/end/activity/decision/approval/system nodes, yes/no branches, actors, drag and drop,
connect and reconnect, delete, undo/redo, automatic layout, zoom and pan), properties panel, findings review,
live validation, save and reopen with optimistic locking and crash recovery, approval and versioning.

Not in Phase 1 by design: fields, stories, backlog, sprints, testing, defects, analytics and organisation-wide
user administration. They appear in the navigation as Coming Soon.
