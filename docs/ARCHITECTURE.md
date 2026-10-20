# ProductFlow AI: Architecture

ProductFlow AI is an AI-assisted product management and delivery platform. It connects business process
design, data requirements, user stories, delivery and UAT through one structured, traceable requirements
model. This document describes the overall architecture, the data model, how modules depend on each other,
and what each phase delivers.

## 1. System overview

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│  apps/web  (React + Vite)  │  JWT   │  apps/api  (Node + Fastify)  │
│  Tailwind, React Flow,     ├───────►│  • Claude process analysis   │
│  Dagre, React Router,      │ /api/* │  • Response validation (zod) │
│  TanStack Query            │        │  • Delivery service (rules)  │
└──────────┬─────────────────┘        │  • Holds ANTHROPIC_API_KEY   │
           │ supabase-js              └──────────────┬───────────────┘
           │ (user JWT, RLS applies)                 │ user's JWT for Phases 1-2; service
           ▼                                         ▼  role for delivery, after role checks
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

| Principle                    | How it is enforced                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single source of truth       | One relational model in Postgres; `packages/domain` is the only definition of its TypeScript shape. React Flow only renders a projection of the domain graph.                                                                                                                                                                   |
| Server-side authorisation    | RLS on every table. Process and data writes go through RPCs that check the caller's project role, called with the user's own JWT. Delivery writes go through the API's delivery service, which checks the role and workflow rules; users have no direct write access to those tables. The UI hides controls only for usability. |
| Human-in-the-loop AI         | Claude's output is schema-validated and shown as a proposal. Nothing is stored until a Business Analyst accepts it into a draft and saves. Inferred steps and findings are labelled; findings stay Draft until accepted or dismissed.                                                                                           |
| Traceable, versioned changes | Approved versions are frozen by triggers; changes create a new draft version. Every element has a lineage `element_key` and a human-readable ref code that survive versioning. Saves use optimistic locking; changes are audit-logged.                                                                                          |

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

### Data requirements (Phase 2)

| Table                      | Purpose                                                                                                                                                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `field_definitions`        | The project's data dictionary of **logical** business fields (`FLD-001`…): type, allowed values, default, source (user-entered / system-generated / retrieved), status (draft / confirmed / deprecated), origin                                                             |
| `physical_columns`         | Columns in physical systems, kept separate from logical fields                                                                                                                                                                                                              |
| `field_column_mappings`    | Many-to-many field ↔ column, with an optional transformation (e.g. "Outstanding Amount = (principal + interest) / 100")                                                                                                                                                     |
| `validation_rules`         | Rules on a field (`VR-001`…): type (required, format, range, length, conditional, cross-field, lookup, duplicate, custom), structured parameters, statement, error message, the analyst's original wording, draft/confirmed, optional link to the business rule it enforces |
| `business_rules`           | One register of business rules (`BR-001`…), draft / approved / retired, optionally promoted from a process finding (kept as `source_finding_key`)                                                                                                                           |
| `business_rule_activities` | Links rules to activities by process and element key, so links survive new process versions                                                                                                                                                                                 |
| `activity_fields`          | Per process **version**: which dictionary fields each activity reads (input) or produces (output), mandatory yes/no/conditional with the condition                                                                                                                          |
| `activity_outputs`         | Per process version: other outputs (record updates, generated documents, notifications, status changes). The next activity is not stored: it comes from the map                                                                                                             |
| `ai_task_runs`             | Every field-suggestion and rule-translation call                                                                                                                                                                                                                            |

Activity inputs and outputs follow the process version lifecycle: editable in a draft (`save_version_data`, with its own
`data_revision` for optimistic locking), frozen by triggers once the version is approved, copied into new drafts, and
removed with an activity that is removed from the map (foreign key cascade). Dictionary fields, validation rules and
business rules are project-level reference data with their own `revision` for optimistic locking; a field used by any
activity cannot be deleted (deprecate it), an approved business rule cannot be reworded or deleted (return it to draft,
or retire it), and only Product Owners and Administrators approve business rules (enforced by trigger).

### Delivery (Phases 3 to 7)

| Table                | Holds                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `stories`            | Functional (`US-`) and technical (`TS-`) stories: content, review status, design status, links, and backlog/work fields                       |
| `sprints`            | Sprints (`SPR-`) with dates, capacity, team and status                                                                                        |
| `sprint_items`       | Backlog items allocated to a sprint (planned hours, developer, planned dates, `committed`, `removed_at`). The story keeps its backlog record  |
| `business_scenarios` | UAT scenarios (`BS-`) with preconditions, steps, linked technical stories, prerequisites and a content version                                |
| `test_executions`    | UAT runs (`TE-`): a snapshot of the steps, per-step results, tester and outcome. Immutable once completed (trigger)                           |
| `defects`            | Defects (`DEF-`) with severity, priority, status, the scenario/execution/step they came from, linked stories, sprint and screenshots          |
| `delivery_events`    | Append-only history: review and Kanban status changes (previous value, new value, who, when), effort updates, assignments, flags and comments |
| `ai_insights`        | Change-impact reviews and process improvement recommendations, with their accept/dismiss decisions                                            |
| `delivery_settings`  | Per-project workflow rules: strict Kanban order, concurrent sprints, estimate before development, default capacity                            |

Links between delivery records and the rest of the model (story ↔ activity, field, validation rule, business rule;
technical ↔ functional story, many-to-many; dependencies; scenario ↔ technical stories; defect ↔ stories) are JSON
arrays of ids on the owning record. The delivery service checks on every write that each id belongs to the same
project and is of the right kind, and rejects dependency loops.

**Why delivery writes go through the API.** The delivery workflow has many rules (who may make which status change,
which Kanban moves are allowed, when a scenario is ready, what a defect may move to). They are written once, in
TypeScript, in `packages/domain/src/delivery/service.ts`, and unit-tested. The API runs them for signed-in users and
then writes with the Supabase service role; signed-in users can read their projects' delivery rows (RLS) but have no
write privileges on them, so the rules cannot be bypassed. The in-browser demo runs the same service code over browser
storage. Triggers still guard what must never happen whoever writes: completed test executions and the history log
cannot change, and an original estimate cannot be overwritten. A multi-record operation is not one database
transaction; each write is checked with optimistic locking, and the demo rolls a failed operation back.

**Traceability.** `traceActivity` (in `packages/domain/src/delivery/trace.ts`) walks from one activity to its fields,
validation and business rules, functional and technical stories (with development status and sprint), test scenarios
with their latest UAT result, and open defects.

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

## 4. Permissions

| Action                                                   | Admin | Product Owner | Business Analyst | Developer | Business User |
| -------------------------------------------------------- | :---: | :-----------: | :--------------: | :-------: | :-----------: |
| Read project processes                                   |   ✓   |       ✓       |        ✓         |     ✓     |       ✓       |
| Create/edit processes, run AI analysis                   |   ✓   |               |        ✓         |           |               |
| Approve a process version                                |   ✓   |       ✓       |                  |           |               |
| Manage members, rename project                           |   ✓   |               |                  |           |               |
| Read audit log                                           |   ✓   |       ✓       |                  |           |               |
| Edit fields, rules, inputs & outputs; run AI suggestions |   ✓   |               |        ✓         |           |               |
| Approve a business rule                                  |   ✓   |       ✓       |                  |           |               |

Delivery (Phases 3 to 7):

| Action                                                          | Admin | Product Owner | Business Analyst | Developer | Business User |
| --------------------------------------------------------------- | :---: | :-----------: | :--------------: | :-------: | :-----------: |
| Write functional stories; write test scenarios                  |   ✓   |               |        ✓         |           |               |
| Write technical stories                                         |   ✓   |               |        ✓         |     ✓     |               |
| Confirm a proposed technical design                             |   ✓   |               |                  |     ✓     |               |
| Approve stories and scenarios, prioritise backlog, plan sprints |   ✓   |       ✓       |                  |           |               |
| Estimate, assign, move Kanban cards, update effort              |   ✓   |       ✓       |                  |     ✓     |               |
| Run UAT, close or reopen a defect after retest                  |   ✓   |       ✓       |        ✓         |           |       ✓       |
| Work on defects (assign, in progress, ready for retest)         |   ✓   |       ✓       |                  |     ✓     |               |
| Change impact analysis and improvement recommendations          |   ✓   |       ✓       |        ✓         |           |               |
| Delivery settings                                               |   ✓   |               |                  |           |               |
| Raise a defect, comment                                         |   ✓   |       ✓       |        ✓         |     ✓     |       ✓       |

The matrices live in `packages/domain/src/roles.ts` and `packages/domain/src/delivery/workflow.ts`. Phases 1 and 2 are
enforced by RLS policies and RPC checks; delivery is enforced by the delivery service on the server.

### Delivery workflow rules

- **Stories:** Draft → Pending Review (needs a title, acceptance criteria, and for technical stories a confirmed design)
  → Approved (Product Owner) → Added to Backlog. Only drafts can be edited; reopening an approved story increases its
  version and is only possible before work starts and outside an open sprint.
- **Kanban:** six columns, To-do → In Planning → In Development → Ready for Testing → In Testing → Completed. With the
  strict setting, cards move forward one column at a time; moving back is always allowed. Development needs an active
  sprint, an assignee and an estimate (configurable), no block, and completed dependencies. Completion sets the
  completion date and zero remaining hours; the original estimate is kept.
- **Sprints:** Planned → Active → Completed, or Cancelled. One active sprint per team unless concurrent sprints are
  allowed. Items added before the start are the commitment; items added later are tracked separately.
- **Scenarios:** Not Ready for Testing until approved, every linked technical story is Completed and prerequisites are
  met; then Ready for UAT. The UAT status is the latest completed execution: a failed scenario stays failed until it is
  retested, and nothing is marked passed automatically.
- **Defects:** Open → Assigned → In Progress → Ready for Retest → Closed, or Reopened from Ready for Retest or Closed.
  Testers verify (close or reopen after retest); a Product Owner or Administrator can close one that will not be fixed.

### Metrics

Computed only from stored records (`packages/domain/src/delivery/metrics.ts`): capacity and utilisation; velocity as
two separate measures, story points and estimated hours, counting only committed stories completed within the sprint
window (stories added mid-sprint are reported apart, and work completed after the sprint does not count); completion
rate; burndown from recorded effort updates; WIP, average cycle time (development start to completion), ageing,
blocked stories, developer workload, defect counts and the UAT pass rate.

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

Phase 2 adds two structured tasks on the same runner (`ClaudeStructuredRunner` in `apps/api/src/ai/analyser.ts`):

- `POST /api/field-suggestions` `{ versionId, nodeKeys? }`: proposes input/output fields and other outputs per activity.
  The prompt lists the activities (with short ids A1, A2…), the existing dictionary (so fields are reused by ref code)
  and the business rules already recorded. `suggestionsToProposal` reuses existing fields by ref code or name and
  proposes each new field once across activities. The analyst ticks what to add; new fields are created as drafts.
- `POST /api/rule-translation` `{ fieldId, text }`: turns plain-language validation logic into structured rules
  and, where the text states policy, business rules. Proposed business rules that repeat a register entry are
  flagged and left unticked. Everything is added as a draft for the analyst to confirm.

Phases 3 to 7 add six tasks, each defined once in `packages/domain/src/delivery/ai.ts` as a prompt, a structured-output
schema and a validator (which also checks every ref code the reply uses): functional story generation from an approved
process, technical story generation from a functional story (designs are labelled Proposed; the only database objects
presented as existing are the recorded physical columns), business scenario generation, story refinement, change-impact
assessment and process improvement recommendations. They run through `POST /api/delivery/:op` on the same runner and
are recorded in `ai_task_runs`. Every result is a proposal: accepted stories and scenarios start as drafts, change
impact only flags items for review, and recommendations wait for an accept or dismiss.

The prompts (in `packages/domain`, shared with the demo) instruct Claude to build the model only from the description, mark
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

## 8. Delivered scope

### Phases 3 to 7 (delivery)

- **Tech User Story:** functional and technical stories with flows, acceptance criteria, technical design and links;
  AI generation and refinement with review; submit, approve, add to backlog, reopen with versioning; history and
  comments.
- **Business User Story:** business scenarios (main, alternative, exception) generated from stories, shown greyed out
  with the reasons until Ready for UAT.
- **Product Backlog** (rank, priority, value, points, estimates, developer, sprint, filters), **Sprint Planning**
  (capacity and utilisation with over-capacity warning, per-developer allocation, planned dates, dependency warnings,
  start/complete/cancel) and **Development Kanban** (drag and drop between the six columns, card details, effort,
  blocking, comments and status history).
- **Business Testing:** step-by-step execution, defects raised from a failed step with the scenario, step, stories,
  expected and actual results and screenshots; completed tests kept as history. **Defect Tracking:** the register and
  lifecycle.
- **Delivery Dashboard** (Recharts), **Requirement Insights** (consistency checks, change impact, improvement
  recommendations), **Traceability**, **Users & Roles** (members and the permission matrix) and **Settings**.

### Phase 2 (data requirements)

Input & Output Designer with three views: **Activities** (per process version: input and output fields with
mandatory/conditional rules, other outputs, the next activity from the map, live checks, AI suggestions with review),
**Data dictionary** (search, status, rules, physical column mappings, where each field is used across process versions),
and **Business rules** (register with approval, activity links, and import from process findings). The Process Designer
links each activity to its inputs and outputs, and approval lists open data-requirement issues for acknowledgement.

### Phase 1 (process design)

Delivered: application shell and navigation (future modules marked Coming Soon), authentication, projects and
member roles, process creation and description editing, Claude analysis with review-before-accept, interactive
React Flow map (start/end/activity/decision/approval/system nodes, yes/no branches, actors, drag and drop,
connect and reconnect, delete, undo/redo, automatic layout, zoom and pan), properties panel, findings review,
live validation, save and reopen with optimistic locking and crash recovery, approval and versioning.

### Demo build

`npm run build:demo --workspace @productflow/web` builds the whole app as one self-contained page that runs without a
server: `src/lib/backend/demo.ts` implements the same backend interface in the browser (with the database's rules
re-implemented and unit-tested) and reaches Claude through the Claude artifact runtime when it is opened on claude.ai. Elsewhere it uses labelled sample
responses, or the visitor's own Anthropic API key kept only for that browser tab. The same build is deployed to GitHub
Pages by `.github/workflows/pages.yml`. It is for demonstrations; the production deployment is the web app, the API
and Supabase.
