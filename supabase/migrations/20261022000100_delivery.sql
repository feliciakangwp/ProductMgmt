-- ProductFlow AI, Phases 3 to 7: user stories, backlog, sprints, Kanban,
-- business test scenarios, UAT executions, defects and AI insights.
--
-- Writes to these tables go through the ProductFlow API's delivery service
-- (packages/domain/src/delivery/service.ts), which checks the caller's
-- project role and applies the workflow rules, then writes with the service
-- role. Signed-in users can read their projects' rows (RLS below) but cannot
-- write them directly. The triggers here are a second line of defence for
-- the rules that must never be broken: completed test executions and the
-- history log are immutable, and an original estimate is never overwritten.
--
-- Column names are the snake_case form of the service's field names, so the
-- API maps rows to records generically.

-- AI runs now cover the delivery tasks too.
alter table public.ai_task_runs alter column task type text using task::text;
drop type public.ai_task;
alter table public.ai_task_runs add constraint ai_task_runs_task_check check (task ~ '^[a-z_]{1,60}$');

create function public.is_json_array(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$ select jsonb_typeof(p) = 'array' $$;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table public.delivery_settings (
  project_id uuid primary key references public.projects (id) on delete cascade,
  strict_workflow boolean not null default true,
  allow_concurrent_sprints boolean not null default false,
  require_estimate_for_development boolean not null default true,
  default_sprint_capacity_hours numeric(8, 1) not null default 80 check (default_sprint_capacity_hours >= 0),
  revision integer not null default 1
);

-- ---------------------------------------------------------------------------
-- Stories and backlog items
-- ---------------------------------------------------------------------------

create table public.stories (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref_code text not null,
  story_type text not null check (story_type in ('functional', 'technical')),
  title text not null check (length(trim(title)) between 1 and 300),
  status text not null check (status in ('draft', 'pending_review', 'approved', 'in_backlog')),
  origin text not null check (origin in ('stated', 'inferred', 'manual')),
  version integer not null default 1,
  user_role text not null default '',
  objective text not null default '',
  benefit text not null default '',
  description text not null default '',
  behaviour jsonb not null default '[]' check (public.is_json_array(behaviour)),
  alternative_flows jsonb not null default '[]' check (public.is_json_array(alternative_flows)),
  acceptance_criteria jsonb not null default '[]' check (public.is_json_array(acceptance_criteria)),
  notes text not null default '',
  api_behaviour text not null default '',
  required_data text not null default '',
  validation_logic text not null default '',
  expected_response text not null default '',
  error_scenarios jsonb not null default '[]' check (public.is_json_array(error_scenarios)),
  design_status text not null check (design_status in ('proposed', 'confirmed')),
  activities jsonb not null default '[]' check (public.is_json_array(activities)),
  field_ids jsonb not null default '[]' check (public.is_json_array(field_ids)),
  validation_rule_ids jsonb not null default '[]' check (public.is_json_array(validation_rule_ids)),
  business_rule_ids jsonb not null default '[]' check (public.is_json_array(business_rule_ids)),
  implements_ids jsonb not null default '[]' check (public.is_json_array(implements_ids)),
  depends_on_ids jsonb not null default '[]' check (public.is_json_array(depends_on_ids)),
  priority text not null check (priority in ('critical', 'high', 'medium', 'low')),
  business_value integer check (business_value between 1 and 10),
  story_points numeric(8, 1) check (story_points >= 0),
  original_estimate_hours numeric(8, 1) check (original_estimate_hours >= 0),
  estimate_hours numeric(8, 1) check (estimate_hours >= 0),
  remaining_hours numeric(8, 1) check (remaining_hours >= 0),
  actual_hours numeric(8, 1) not null default 0 check (actual_hours >= 0),
  assignee_id uuid references public.profiles (id),
  backlog_rank integer not null default 0,
  work_status text not null check (work_status in ('todo', 'in_planning', 'in_development', 'ready_for_testing', 'in_testing', 'completed')),
  blocked boolean not null default false,
  blocked_reason text not null default '',
  review_flag text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revision integer not null,
  unique (project_id, ref_code)
);

create index stories_project_idx on public.stories (project_id, backlog_rank);

-- ---------------------------------------------------------------------------
-- Sprints
-- ---------------------------------------------------------------------------

create table public.sprints (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref_code text not null,
  name text not null check (length(trim(name)) between 1 and 300),
  objective text not null default '',
  start_date date not null,
  end_date date not null,
  status text not null check (status in ('planned', 'active', 'completed', 'cancelled')),
  capacity_hours numeric(8, 1) not null check (capacity_hours >= 0),
  team text not null default '',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null,
  revision integer not null,
  unique (project_id, ref_code),
  check (end_date >= start_date)
);

create table public.sprint_items (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  sprint_id uuid not null references public.sprints (id) on delete cascade,
  story_id uuid not null references public.stories (id) on delete cascade,
  planned_hours numeric(8, 1) not null check (planned_hours >= 0),
  assignee_id uuid references public.profiles (id),
  planned_start date,
  planned_end date,
  committed boolean not null,
  added_at timestamptz not null,
  removed_at timestamptz
);

create index sprint_items_sprint_idx on public.sprint_items (sprint_id);
-- A story is allocated to a sprint at most once at a time.
create unique index sprint_items_open_idx on public.sprint_items (sprint_id, story_id) where removed_at is null;

-- ---------------------------------------------------------------------------
-- Business scenarios, UAT executions and defects
-- ---------------------------------------------------------------------------

create table public.business_scenarios (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref_code text not null,
  title text not null check (length(trim(title)) between 1 and 300),
  scenario_type text not null check (scenario_type in ('main', 'alternative', 'exception')),
  description text not null default '',
  process_id uuid references public.processes (id) on delete set null,
  activities jsonb not null default '[]' check (public.is_json_array(activities)),
  preconditions jsonb not null default '[]' check (public.is_json_array(preconditions)),
  steps jsonb not null default '[]' check (public.is_json_array(steps)),
  story_ids jsonb not null default '[]' check (public.is_json_array(story_ids)),
  prerequisites text not null default '',
  prerequisites_met boolean not null default false,
  status text not null check (status in ('draft', 'approved')),
  origin text not null check (origin in ('stated', 'inferred', 'manual')),
  version integer not null,
  review_flag text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revision integer not null,
  unique (project_id, ref_code)
);

create table public.test_executions (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref_code text not null,
  scenario_id uuid not null references public.business_scenarios (id),
  scenario_version integer not null,
  steps jsonb not null check (public.is_json_array(steps)),
  results jsonb not null check (public.is_json_array(results)),
  status text not null check (status in ('in_progress', 'passed', 'failed', 'blocked')),
  tester_id uuid not null references public.profiles (id),
  remarks text not null default '',
  started_at timestamptz not null,
  completed_at timestamptz,
  revision integer not null,
  unique (project_id, ref_code)
);

create index test_executions_scenario_idx on public.test_executions (scenario_id, started_at desc);

create table public.defects (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref_code text not null,
  title text not null check (length(trim(title)) between 1 and 300),
  description text not null default '',
  severity text not null check (severity in ('critical', 'major', 'minor', 'trivial')),
  priority text not null check (priority in ('critical', 'high', 'medium', 'low')),
  status text not null check (status in ('open', 'assigned', 'in_progress', 'ready_for_retest', 'closed', 'reopened')),
  scenario_id uuid references public.business_scenarios (id),
  execution_id uuid references public.test_executions (id),
  step_id text,
  expected_result text not null default '',
  actual_result text not null default '',
  remarks text not null default '',
  story_ids jsonb not null default '[]' check (public.is_json_array(story_ids)),
  assignee_id uuid references public.profiles (id),
  sprint_id uuid references public.sprints (id) on delete set null,
  -- Screenshots as data URLs, limited in size by the service (see MAX_ATTACHMENT_BYTES).
  attachments jsonb not null default '[]' check (public.is_json_array(attachments) and octet_length(attachments::text) < 2000000),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null,
  resolved_at timestamptz,
  revision integer not null,
  unique (project_id, ref_code)
);

-- ---------------------------------------------------------------------------
-- History and AI insights
-- ---------------------------------------------------------------------------

create table public.delivery_events (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  entity_type text not null check (entity_type in ('story', 'sprint', 'scenario', 'execution', 'defect')),
  entity_id uuid not null,
  kind text not null check (kind in ('created', 'status', 'work_status', 'effort', 'comment', 'assignment', 'flag', 'edit')),
  from_value text,
  to_value text,
  body text not null default '',
  actor_id uuid not null references public.profiles (id),
  created_at timestamptz not null
);

create index delivery_events_entity_idx on public.delivery_events (entity_id, created_at);
create index delivery_events_project_idx on public.delivery_events (project_id, created_at);

create table public.ai_insights (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('change_impact', 'improvement', 'consistency')),
  title text not null,
  detail text not null default '',
  subjects jsonb not null default '[]' check (public.is_json_array(subjects)),
  impact text not null check (impact in ('high', 'medium', 'low')),
  process_id uuid references public.processes (id) on delete set null,
  status text not null check (status in ('open', 'accepted', 'dismissed')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

create function public.guard_story()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.original_estimate_hours is not null and new.original_estimate_hours is distinct from old.original_estimate_hours then
    raise exception 'The original estimate of % cannot be changed', old.ref_code using errcode = 'PF423';
  end if;
  if new.ref_code <> old.ref_code or new.story_type <> old.story_type or new.project_id <> old.project_id then
    raise exception 'A story''s reference, type and project cannot change' using errcode = 'PF423';
  end if;
  return new;
end;
$$;

create trigger stories_guard before update on public.stories
for each row execute function public.guard_story();

create function public.guard_test_execution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Test history cannot be deleted' using errcode = 'PF423';
  end if;
  if old.status <> 'in_progress' then
    raise exception 'Test execution % is completed and cannot be changed', old.ref_code using errcode = 'PF423';
  end if;
  if new.scenario_id <> old.scenario_id or new.scenario_version <> old.scenario_version or new.steps <> old.steps then
    raise exception 'The scenario a test execution ran cannot change' using errcode = 'PF423';
  end if;
  return new;
end;
$$;

create trigger test_executions_guard before update or delete on public.test_executions
for each row execute function public.guard_test_execution();

create function public.guard_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'History is append-only' using errcode = 'PF423';
end;
$$;

create trigger delivery_events_append_only before update or delete on public.delivery_events
for each row execute function public.guard_append_only();

create trigger stories_audit after insert or update or delete on public.stories
for each row execute function public.audit_row('project_id');
create trigger sprints_audit after insert or update or delete on public.sprints
for each row execute function public.audit_row('project_id');
create trigger business_scenarios_audit after insert or update or delete on public.business_scenarios
for each row execute function public.audit_row('project_id');
create trigger defects_audit after insert or update or delete on public.defects
for each row execute function public.audit_row('project_id');

-- ---------------------------------------------------------------------------
-- Row level security and privileges
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['delivery_settings', 'stories', 'sprints', 'sprint_items', 'business_scenarios',
                           'test_executions', 'defects', 'delivery_events', 'ai_insights'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_project_member(project_id))', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- The history log only grows.
revoke update, delete on public.delivery_events from service_role;

-- What the API's delivery service reads with the service role, and the AI run log it writes.
grant usage on schema public to service_role;
grant select on public.projects, public.project_members, public.profiles, public.processes, public.process_versions,
  public.process_nodes, public.process_edges, public.actors, public.activity_fields, public.field_definitions,
  public.validation_rules, public.business_rules, public.business_rule_activities, public.physical_columns,
  public.field_column_mappings
  to service_role;
grant select, insert on public.ai_task_runs to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_project_member(uuid),
  public.has_project_role(uuid, public.project_role[]),
  public.is_json_array(jsonb),
  public.create_project(text, text, text),
  public.add_project_member(uuid, text, public.project_role),
  public.update_member_role(uuid, uuid, public.project_role),
  public.remove_project_member(uuid, uuid),
  public.create_process(uuid, text, public.process_type, text, text, text),
  public.ensure_actors(uuid, jsonb),
  public.save_process_draft(uuid, integer, text, jsonb, jsonb, jsonb, uuid),
  public.approve_process_version(uuid, integer),
  public.create_draft_from_version(uuid),
  public.save_version_data(uuid, integer, jsonb, jsonb),
  public.promote_finding_to_business_rule(uuid, uuid, text, public.business_rule_category)
  to authenticated;
grant execute on function public.next_ref(uuid, text), public.is_json_array(jsonb) to service_role;
