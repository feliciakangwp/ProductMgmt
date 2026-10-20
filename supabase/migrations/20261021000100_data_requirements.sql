-- ProductFlow AI: Module 2, Input & Output Designer (Phase 2).
--
-- * A project-level data dictionary of logical business fields, each with
--   validation rules, mapped many-to-many to physical columns.
-- * A project-level business rule register, linked to process activities and
--   optionally to the process finding a rule was promoted from.
-- * Per process version: which dictionary fields each activity reads or
--   produces, and its other outputs. These follow the version lifecycle like
--   the map itself: editable in a draft, frozen once approved, copied into
--   new drafts.

create type public.data_type as enum (
  'string', 'text', 'integer', 'decimal', 'currency', 'date', 'datetime', 'boolean', 'enum', 'file', 'reference'
);
create type public.field_source as enum ('user_entered', 'system_generated', 'retrieved');
create type public.field_status as enum ('draft', 'approved', 'deprecated');
create type public.mandatory_option as enum ('yes', 'no', 'conditional');
create type public.io_direction as enum ('input', 'output');
create type public.output_kind as enum ('record_update', 'document', 'notification', 'status_change');
create type public.rule_type as enum (
  'required', 'format', 'range', 'length', 'conditional_required', 'cross_field', 'lookup', 'duplicate', 'custom'
);
create type public.rule_status as enum ('draft', 'confirmed');
create type public.business_rule_category as enum ('eligibility', 'approval', 'calculation', 'validation', 'policy', 'other');
create type public.business_rule_status as enum ('draft', 'approved', 'retired');

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------

-- Assigns a ref code on insert. TG_ARGV[0] is the prefix (FLD, VR, BR).
create function public.assign_ref_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ref_code is null or new.ref_code = '' then
    new.ref_code := public.next_ref(new.project_id, tg_argv[0]);
  end if;
  return new;
end;
$$;

-- Bumps `revision` and `updated_at` on every update, for optimistic locking.
create function public.bump_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ref_code is distinct from old.ref_code or new.project_id <> old.project_id then
    raise exception 'Identifiers cannot change' using errcode = 'PF423';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Data dictionary
-- ---------------------------------------------------------------------------

create table public.field_definitions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  ref_code text not null,
  name text not null,
  description text not null default '',
  data_type public.data_type not null default 'string',
  allowed_values text[] not null default '{}',
  default_value text not null default '',
  source public.field_source not null default 'user_entered',
  source_detail text not null default '',
  status public.field_status not null default 'draft',
  origin public.element_origin not null default 'manual',
  revision integer not null default 1,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_definitions_name_length check (char_length(trim(name)) between 1 and 200),
  constraint field_definitions_description_length check (char_length(description) <= 4000),
  constraint field_definitions_default_length check (char_length(default_value) <= 500),
  constraint field_definitions_source_detail_length check (char_length(source_detail) <= 500),
  constraint field_definitions_allowed_values_count check (cardinality(allowed_values) <= 200),
  unique (project_id, ref_code)
);

create index field_definitions_project_idx on public.field_definitions (project_id, lower(name));

create table public.physical_columns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  system_name text not null,
  table_name text not null,
  column_name text not null,
  data_type text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint physical_columns_lengths check (
    char_length(trim(system_name)) between 1 and 200 and char_length(trim(table_name)) between 1 and 200
    and char_length(trim(column_name)) between 1 and 200 and char_length(data_type) <= 100 and char_length(notes) <= 2000
  )
);

create unique index physical_columns_unique on public.physical_columns (
  project_id, lower(system_name), lower(table_name), lower(column_name)
);

create table public.field_column_mappings (
  field_id uuid not null references public.field_definitions (id) on delete cascade,
  column_id uuid not null references public.physical_columns (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  transformation text not null default '',
  primary key (field_id, column_id),
  constraint field_column_mappings_transformation_length check (char_length(transformation) <= 2000)
);

-- ---------------------------------------------------------------------------
-- Business rules
-- ---------------------------------------------------------------------------

create table public.business_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  ref_code text not null,
  title text not null,
  statement text not null,
  category public.business_rule_category not null default 'other',
  status public.business_rule_status not null default 'draft',
  origin public.element_origin not null default 'manual',
  -- The process finding this rule was promoted from, if any.
  source_version_id uuid references public.process_versions (id) on delete set null,
  source_finding_key uuid,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  revision integer not null default 1,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_rules_title_length check (char_length(trim(title)) between 1 and 200),
  constraint business_rules_statement_length check (char_length(trim(statement)) between 1 and 4000),
  unique (project_id, ref_code)
);

-- A finding is promoted at most once.
create unique index business_rules_source_finding on public.business_rules (project_id, source_finding_key)
  where source_finding_key is not null;

create table public.business_rule_activities (
  business_rule_id uuid not null references public.business_rules (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  process_id uuid not null references public.processes (id) on delete cascade,
  -- Element key of the activity; lineage keys stay valid across process versions.
  node_key uuid not null,
  primary key (business_rule_id, process_id, node_key)
);

-- ---------------------------------------------------------------------------
-- Validation rules (on dictionary fields)
-- ---------------------------------------------------------------------------

create table public.validation_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  field_id uuid not null references public.field_definitions (id) on delete cascade,
  ref_code text not null,
  rule_type public.rule_type not null,
  params jsonb not null default '{}',
  statement text not null,
  error_message text not null default '',
  source_text text,
  origin public.element_origin not null default 'manual',
  status public.rule_status not null default 'draft',
  business_rule_id uuid references public.business_rules (id) on delete set null,
  revision integer not null default 1,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint validation_rules_statement_length check (char_length(trim(statement)) between 1 and 2000),
  constraint validation_rules_error_length check (char_length(error_message) <= 500),
  constraint validation_rules_params_object check (jsonb_typeof(params) = 'object'),
  unique (project_id, ref_code)
);

create index validation_rules_field_idx on public.validation_rules (field_id);

-- ---------------------------------------------------------------------------
-- Activity inputs and outputs (per process version)
-- ---------------------------------------------------------------------------

alter table public.process_versions add column data_revision integer not null default 1;

create table public.activity_fields (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.process_versions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  element_key uuid not null,
  node_key uuid not null,
  field_id uuid not null references public.field_definitions (id) on delete restrict,
  direction public.io_direction not null,
  mandatory public.mandatory_option not null default 'no',
  mandatory_condition text not null default '',
  notes text not null default '',
  origin public.element_origin not null default 'manual',
  sort_order integer not null default 0,
  constraint activity_fields_condition_length check (char_length(mandatory_condition) <= 1000),
  constraint activity_fields_notes_length check (char_length(notes) <= 2000),
  constraint activity_fields_condition_only_when_conditional check (mandatory = 'conditional' or mandatory_condition = ''),
  constraint activity_fields_outputs_not_mandatory check (direction = 'input' or mandatory = 'no'),
  unique (version_id, element_key),
  unique (version_id, node_key, direction, field_id),
  -- Removing an activity from the map removes its data requirements with it.
  foreign key (version_id, node_key) references public.process_nodes (version_id, element_key) on delete cascade
);

create index activity_fields_field_idx on public.activity_fields (field_id);

create table public.activity_outputs (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.process_versions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  element_key uuid not null,
  node_key uuid not null,
  kind public.output_kind not null,
  target text not null default '',
  description text not null default '',
  origin public.element_origin not null default 'manual',
  sort_order integer not null default 0,
  constraint activity_outputs_lengths check (char_length(target) <= 300 and char_length(description) <= 2000),
  constraint activity_outputs_not_empty check (char_length(trim(target)) > 0 or char_length(trim(description)) > 0),
  unique (version_id, element_key),
  foreign key (version_id, node_key) references public.process_nodes (version_id, element_key) on delete cascade
);

-- ---------------------------------------------------------------------------
-- AI runs for data requirements (process analysis runs keep their own table)
-- ---------------------------------------------------------------------------

create type public.ai_task as enum ('field_suggestions', 'rule_translation');

create table public.ai_task_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  task public.ai_task not null,
  -- The process version (field suggestions) or dictionary field (rule translation) the run was for.
  subject_id uuid not null,
  model text not null,
  prompt_version text not null,
  succeeded boolean not null,
  input text not null,
  response jsonb,
  error text,
  usage jsonb,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

create index ai_task_runs_subject_idx on public.ai_task_runs (subject_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger field_definitions_ref before insert on public.field_definitions
for each row execute function public.assign_ref_code('FLD');
create trigger field_definitions_revision before update on public.field_definitions
for each row execute function public.bump_revision();
create trigger field_definitions_audit after insert or update or delete on public.field_definitions
for each row execute function public.audit_row('project_id');

create trigger validation_rules_ref before insert on public.validation_rules
for each row execute function public.assign_ref_code('VR');
create trigger validation_rules_revision before update on public.validation_rules
for each row execute function public.bump_revision();
create trigger validation_rules_audit after insert or update or delete on public.validation_rules
for each row execute function public.audit_row('project_id');

create trigger business_rules_ref before insert on public.business_rules
for each row execute function public.assign_ref_code('BR');
create trigger business_rules_revision before update on public.business_rules
for each row execute function public.bump_revision();
create trigger business_rules_audit after insert or update or delete on public.business_rules
for each row execute function public.audit_row('project_id');

-- Only Product Owners and Administrators approve business rules, and an
-- approved rule's wording cannot change silently: edit means back to draft.
create function public.guard_business_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'approved' then
      raise exception 'A new business rule starts as a draft' using errcode = 'PF422';
    end if;
    return new;
  end if;
  if new.status = 'approved' and old.status <> 'approved' then
    if not public.has_project_role(new.project_id, array['admin', 'product_owner']::public.project_role[]) then
      raise exception 'Only a Product Owner or Administrator can approve a business rule' using errcode = '42501';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif old.status = 'approved' and new.status = 'approved'
        and (new.statement <> old.statement or new.title <> old.title or new.category <> old.category) then
    raise exception 'An approved business rule cannot be reworded. Return it to draft first.' using errcode = 'PF423';
  elsif new.status <> 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end;
$$;

create trigger business_rules_guard before insert or update on public.business_rules
for each row execute function public.guard_business_rule();

create function public.guard_business_rule_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'approved' then
    raise exception 'An approved business rule cannot be deleted. Retire it instead.' using errcode = 'PF423';
  end if;
  return old;
end;
$$;

create trigger business_rules_guard_delete before delete on public.business_rules
for each row execute function public.guard_business_rule_delete();

-- Version content guard (from the process design migration) covers I/O too.
create trigger activity_fields_guard before insert or update or delete on public.activity_fields
for each row execute function public.guard_version_content();
create trigger activity_outputs_guard before insert or update or delete on public.activity_outputs
for each row execute function public.guard_version_content();

-- Keeps project_id consistent with the parent row for directly written tables.
create function public.check_same_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if tg_table_name = 'validation_rules' then
    select exists (select 1 from public.field_definitions f where f.id = new.field_id and f.project_id = new.project_id)
       and (new.business_rule_id is null or exists (
         select 1 from public.business_rules b where b.id = new.business_rule_id and b.project_id = new.project_id))
      into v_ok;
  elsif tg_table_name = 'field_column_mappings' then
    select exists (select 1 from public.field_definitions f where f.id = new.field_id and f.project_id = new.project_id)
       and exists (select 1 from public.physical_columns c where c.id = new.column_id and c.project_id = new.project_id)
      into v_ok;
  elsif tg_table_name = 'business_rule_activities' then
    select exists (select 1 from public.business_rules b where b.id = new.business_rule_id and b.project_id = new.project_id)
       and exists (select 1 from public.processes p where p.id = new.process_id and p.project_id = new.project_id)
      into v_ok;
  end if;
  if not coalesce(v_ok, false) then
    raise exception 'Linked records must belong to the same project' using errcode = 'PF422';
  end if;
  return new;
end;
$$;

create trigger validation_rules_same_project before insert or update on public.validation_rules
for each row execute function public.check_same_project();
create trigger field_column_mappings_same_project before insert or update on public.field_column_mappings
for each row execute function public.check_same_project();
create trigger business_rule_activities_same_project before insert or update on public.business_rule_activities
for each row execute function public.check_same_project();

-- Deprecate rather than delete a field that a process version uses.
create function public.guard_field_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.activity_fields where field_id = old.id) then
    raise exception 'Field % is used by a process activity. Deprecate it instead of deleting it.', old.ref_code
      using errcode = 'PF423';
  end if;
  return old;
end;
$$;

create trigger field_definitions_guard_delete before delete on public.field_definitions
for each row execute function public.guard_field_delete();

-- Approved and superseded versions keep their data revision too.
create or replace function public.guard_version_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.process_id <> old.process_id or new.project_id <> old.project_id
     or new.version_number <> old.version_number then
    raise exception 'Version identity cannot change' using errcode = 'PF423';
  end if;
  if old.status = 'draft' then
    if new.status = 'superseded' then
      raise exception 'A draft must be approved before it can be superseded' using errcode = 'PF423';
    end if;
    return new;
  end if;
  if old.status = 'approved' and new.status = 'superseded'
     and new.description = old.description and new.revision = old.revision
     and new.data_revision = old.data_revision
     and new.approved_by is not distinct from old.approved_by
     and new.approved_at is not distinct from old.approved_at then
    return new;
  end if;
  raise exception 'Version is % and cannot be changed; create a new draft instead', old.status
    using errcode = 'PF423';
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Replaces the inputs and outputs of every activity in a draft version.
create function public.save_version_data(
  p_version_id uuid,
  p_expected_revision integer,
  p_fields jsonb,
  p_outputs jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.process_versions;
begin
  select * into v_version from public.process_versions where id = p_version_id for update;
  if not found then
    raise exception 'Process version not found' using errcode = 'P0002';
  end if;
  if not public.has_project_role(v_version.project_id, array['admin', 'business_analyst']::public.project_role[]) then
    raise exception 'You do not have permission to edit this process' using errcode = '42501';
  end if;
  if v_version.status <> 'draft' then
    raise exception 'Version % is % and cannot be changed; create a new draft instead',
      v_version.version_number, v_version.status using errcode = 'PF423';
  end if;
  if v_version.data_revision <> p_expected_revision then
    raise exception 'The inputs and outputs were saved by someone else since you opened them. Reload to see their changes.'
      using errcode = 'PF409';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_fields, '[]')) as f(field_id uuid)
     where not exists (
       select 1 from public.field_definitions d where d.id = f.field_id and d.project_id = v_version.project_id)
  ) then
    raise exception 'A field is not in this project''s data dictionary' using errcode = 'PF422';
  end if;
  if exists (
    select 1 from (
      select f.node_key from jsonb_to_recordset(coalesce(p_fields, '[]')) as f(node_key uuid)
      union all
      select o.node_key from jsonb_to_recordset(coalesce(p_outputs, '[]')) as o(node_key uuid)
    ) k
    where not exists (
      select 1 from public.process_nodes n
       where n.version_id = p_version_id and n.element_key = k.node_key and n.node_type not in ('start', 'end'))
  ) then
    raise exception 'Inputs and outputs must belong to activities in this version''s process map' using errcode = 'PF422';
  end if;

  delete from public.activity_fields where version_id = p_version_id;
  delete from public.activity_outputs where version_id = p_version_id;

  insert into public.activity_fields (
    version_id, project_id, element_key, node_key, field_id, direction, mandatory, mandatory_condition, notes, origin, sort_order
  )
  select p_version_id, v_version.project_id, f.element_key, f.node_key, f.field_id, f.direction,
         case when f.direction = 'output' then 'no' else coalesce(f.mandatory, 'no') end,
         case when f.direction = 'input' and f.mandatory = 'conditional' then coalesce(f.mandatory_condition, '') else '' end,
         coalesce(f.notes, ''), coalesce(f.origin, 'manual'), coalesce(f.sort_order, 0)
    from jsonb_to_recordset(coalesce(p_fields, '[]')) as f(
      element_key uuid, node_key uuid, field_id uuid, direction public.io_direction, mandatory public.mandatory_option,
      mandatory_condition text, notes text, origin public.element_origin, sort_order integer
    );

  insert into public.activity_outputs (version_id, project_id, element_key, node_key, kind, target, description, origin, sort_order)
  select p_version_id, v_version.project_id, o.element_key, o.node_key, o.kind,
         coalesce(o.target, ''), coalesce(o.description, ''), coalesce(o.origin, 'manual'), coalesce(o.sort_order, 0)
    from jsonb_to_recordset(coalesce(p_outputs, '[]')) as o(
      element_key uuid, node_key uuid, kind public.output_kind, target text, description text,
      origin public.element_origin, sort_order integer
    );

  update public.process_versions set data_revision = data_revision + 1, updated_at = now(), updated_by = auth.uid()
   where id = p_version_id;

  insert into public.audit_log (project_id, table_name, record_id, action, actor_id, new_data)
  values (
    v_version.project_id, 'process_versions', p_version_id, 'save_data', auth.uid(),
    jsonb_build_object(
      'data_revision', v_version.data_revision + 1,
      'fields', jsonb_array_length(coalesce(p_fields, '[]')),
      'outputs', jsonb_array_length(coalesce(p_outputs, '[]'))
    )
  );

  return v_version.data_revision + 1;
end;
$$;

-- New drafts carry the data requirements of the version they are based on.
create or replace function public.create_draft_from_version(p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.process_versions;
  v_existing integer;
  v_new_id uuid;
begin
  select * into v_source from public.process_versions where id = p_version_id;
  if not found then
    raise exception 'Process version not found' using errcode = 'P0002';
  end if;
  if not public.has_project_role(v_source.project_id, array['admin', 'business_analyst']::public.project_role[]) then
    raise exception 'You do not have permission to edit this process' using errcode = '42501';
  end if;

  perform 1 from public.processes where id = v_source.process_id for update;

  select version_number into v_existing
    from public.process_versions where process_id = v_source.process_id and status = 'draft';
  if v_existing is not null then
    raise exception 'Version % is already an open draft for this process', v_existing using errcode = 'PF409';
  end if;

  insert into public.process_versions (
    process_id, project_id, version_number, description, based_on_version_id, created_by, updated_by
  )
  select v_source.process_id, v_source.project_id, max(version_number) + 1, v_source.description,
         v_source.id, auth.uid(), auth.uid()
    from public.process_versions where process_id = v_source.process_id
  returning id into v_new_id;

  insert into public.process_nodes (
    version_id, project_id, element_key, ref_code, node_type, label, description, actor_id,
    position_x, position_y, origin, source_text
  )
  select v_new_id, project_id, element_key, ref_code, node_type, label, description, actor_id,
         position_x, position_y, origin, source_text
    from public.process_nodes where version_id = v_source.id;

  insert into public.process_edges (version_id, project_id, element_key, source_key, target_key, label, condition, branch)
  select v_new_id, project_id, element_key, source_key, target_key, label, condition, branch
    from public.process_edges where version_id = v_source.id;

  insert into public.process_findings (
    version_id, project_id, element_key, kind, statement, source_text, origin, status, related_node_keys, analysis_run_id
  )
  select v_new_id, project_id, element_key, kind, statement, source_text, origin, status, related_node_keys, analysis_run_id
    from public.process_findings where version_id = v_source.id;

  insert into public.activity_fields (
    version_id, project_id, element_key, node_key, field_id, direction, mandatory, mandatory_condition, notes, origin, sort_order
  )
  select v_new_id, project_id, element_key, node_key, field_id, direction, mandatory, mandatory_condition, notes, origin, sort_order
    from public.activity_fields where version_id = v_source.id;

  insert into public.activity_outputs (version_id, project_id, element_key, node_key, kind, target, description, origin, sort_order)
  select v_new_id, project_id, element_key, node_key, kind, target, description, origin, sort_order
    from public.activity_outputs where version_id = v_source.id;

  return v_new_id;
end;
$$;

-- Promotes an accepted business-rule finding into the register, once.
create function public.promote_finding_to_business_rule(
  p_version_id uuid,
  p_finding_key uuid,
  p_title text,
  p_category public.business_rule_category
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finding public.process_findings;
  v_process_id uuid;
  v_rule_id uuid;
  v_node uuid;
begin
  select * into v_finding from public.process_findings where version_id = p_version_id and element_key = p_finding_key;
  if not found then
    raise exception 'Finding not found' using errcode = 'P0002';
  end if;
  if not public.has_project_role(v_finding.project_id, array['admin', 'business_analyst']::public.project_role[]) then
    raise exception 'You do not have permission to manage business rules' using errcode = '42501';
  end if;
  if v_finding.kind <> 'business_rule' or v_finding.status = 'dismissed' then
    raise exception 'Only business-rule findings that are not dismissed can be promoted' using errcode = 'PF422';
  end if;
  if exists (select 1 from public.business_rules where project_id = v_finding.project_id and source_finding_key = p_finding_key) then
    raise exception 'This finding is already in the business rule register' using errcode = 'PF409';
  end if;

  select process_id into v_process_id from public.process_versions where id = p_version_id;

  insert into public.business_rules (project_id, title, statement, category, origin, source_version_id, source_finding_key)
  values (
    v_finding.project_id, coalesce(nullif(trim(p_title), ''), left(v_finding.statement, 200)), v_finding.statement,
    p_category, v_finding.origin, p_version_id, p_finding_key
  )
  returning id into v_rule_id;

  foreach v_node in array v_finding.related_node_keys loop
    insert into public.business_rule_activities (business_rule_id, project_id, process_id, node_key)
    values (v_rule_id, v_finding.project_id, v_process_id, v_node)
    on conflict do nothing;
  end loop;

  return v_rule_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security and privileges
-- ---------------------------------------------------------------------------

alter table public.field_definitions enable row level security;
alter table public.physical_columns enable row level security;
alter table public.field_column_mappings enable row level security;
alter table public.business_rules enable row level security;
alter table public.business_rule_activities enable row level security;
alter table public.validation_rules enable row level security;
alter table public.activity_fields enable row level security;
alter table public.activity_outputs enable row level security;
alter table public.ai_task_runs enable row level security;

grant select, insert (project_id, task, subject_id, model, prompt_version, succeeded, input, response, error, usage)
  on public.ai_task_runs to authenticated;
create policy ai_task_runs_select on public.ai_task_runs for select to authenticated
using (public.is_project_member(project_id));
create policy ai_task_runs_insert on public.ai_task_runs for insert to authenticated
with check (
  public.has_project_role(project_id, array['admin', 'business_analyst']::public.project_role[])
  and created_by = auth.uid()
);

grant select on public.field_definitions, public.physical_columns, public.field_column_mappings, public.business_rules,
  public.business_rule_activities, public.validation_rules, public.activity_fields, public.activity_outputs
  to authenticated;

grant insert (project_id, name, description, data_type, allowed_values, default_value, source, source_detail, status, origin),
  update (name, description, data_type, allowed_values, default_value, source, source_detail, status),
  delete on public.field_definitions to authenticated;
grant insert (project_id, system_name, table_name, column_name, data_type, notes),
  update (system_name, table_name, column_name, data_type, notes),
  delete on public.physical_columns to authenticated;
grant insert (field_id, column_id, project_id, transformation), update (transformation), delete
  on public.field_column_mappings to authenticated;
grant insert (project_id, title, statement, category, status, origin),
  update (title, statement, category, status),
  delete on public.business_rules to authenticated;
grant insert (business_rule_id, project_id, process_id, node_key), delete on public.business_rule_activities to authenticated;
grant insert (project_id, field_id, rule_type, params, statement, error_message, source_text, origin, status, business_rule_id),
  update (rule_type, params, statement, error_message, status, business_rule_id),
  delete on public.validation_rules to authenticated;

-- Read: any project member. Write: Administrators and Business Analysts;
-- Product Owners may also update business rules (to approve them).
do $$
declare
  t text;
begin
  foreach t in array array['field_definitions', 'physical_columns', 'field_column_mappings', 'business_rules',
                           'business_rule_activities', 'validation_rules', 'activity_fields', 'activity_outputs'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_project_member(project_id))', t);
  end loop;
  foreach t in array array['field_definitions', 'physical_columns', 'field_column_mappings', 'business_rules',
                           'business_rule_activities', 'validation_rules'] loop
    execute format($f$create policy %1$s_insert on public.%1$s for insert to authenticated
      with check (public.has_project_role(project_id, array['admin', 'business_analyst']::public.project_role[]))$f$, t);
    execute format($f$create policy %1$s_delete on public.%1$s for delete to authenticated
      using (public.has_project_role(project_id, array['admin', 'business_analyst']::public.project_role[]))$f$, t);
  end loop;
  foreach t in array array['field_definitions', 'physical_columns', 'field_column_mappings', 'validation_rules'] loop
    execute format($f$create policy %1$s_update on public.%1$s for update to authenticated
      using (public.has_project_role(project_id, array['admin', 'business_analyst']::public.project_role[]))
      with check (public.has_project_role(project_id, array['admin', 'business_analyst']::public.project_role[]))$f$, t);
  end loop;
end $$;

create policy business_rules_update on public.business_rules for update to authenticated
using (public.has_project_role(project_id, array['admin', 'business_analyst', 'product_owner']::public.project_role[]))
with check (public.has_project_role(project_id, array['admin', 'business_analyst', 'product_owner']::public.project_role[]));

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_project_member(uuid),
  public.has_project_role(uuid, public.project_role[]),
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
