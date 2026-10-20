-- ProductFlow AI: Module 1, Process Designer.
--
-- A process has numbered versions. At most one version per process is a
-- draft; only drafts can change. Approving a draft supersedes the previous
-- approved version instead of overwriting it. Nodes, edges and findings carry
-- an element_key that is preserved when a version is copied into a new draft,
-- so later modules can trace a requirement across versions.

create type public.process_type as enum ('as_is', 'to_be');
create type public.version_status as enum ('draft', 'approved', 'superseded');
create type public.node_type as enum ('start', 'end', 'activity', 'decision', 'approval', 'system');
create type public.edge_branch as enum ('yes', 'no', 'other');
create type public.actor_kind as enum ('role', 'system', 'external');
create type public.element_origin as enum ('stated', 'inferred', 'manual');
create type public.finding_kind as enum ('business_rule', 'exception', 'missing_information', 'ambiguity');
create type public.finding_status as enum ('draft', 'accepted', 'dismissed');

-- ---------------------------------------------------------------------------
-- Actors: project-level roles, systems and external parties, reused across processes
-- ---------------------------------------------------------------------------

create table public.actors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  kind public.actor_kind not null default 'role',
  description text not null default '',
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint actors_name_length check (char_length(trim(name)) between 1 and 120),
  constraint actors_description_length check (char_length(description) <= 2000)
);

create unique index actors_project_name_unique on public.actors (project_id, lower(trim(name)));

-- ---------------------------------------------------------------------------
-- Processes and versions
-- ---------------------------------------------------------------------------

create table public.processes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  ref_code text not null,
  name text not null,
  process_type public.process_type not null default 'as_is',
  owner text not null default '',
  business_unit text not null default '',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processes_name_length check (char_length(trim(name)) between 1 and 200),
  constraint processes_owner_length check (char_length(owner) <= 200),
  constraint processes_business_unit_length check (char_length(business_unit) <= 200),
  unique (project_id, ref_code)
);

create index processes_project_idx on public.processes (project_id);

create table public.process_versions (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.processes (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  version_number integer not null,
  status public.version_status not null default 'draft',
  description text not null default '',
  -- Incremented on every save; used for optimistic concurrency control.
  revision integer not null default 1,
  based_on_version_id uuid references public.process_versions (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  constraint process_versions_description_length check (char_length(description) <= 50000),
  constraint process_versions_approval_consistent check (
    (status = 'draft' and approved_at is null) or (status <> 'draft' and approved_at is not null)
  ),
  unique (process_id, version_number)
);

create unique index process_versions_one_draft on public.process_versions (process_id) where status = 'draft';
create index process_versions_process_idx on public.process_versions (process_id, version_number desc);

-- ---------------------------------------------------------------------------
-- Graph content of a version
-- ---------------------------------------------------------------------------

create table public.process_nodes (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.process_versions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  element_key uuid not null,
  ref_code text,
  node_type public.node_type not null,
  label text not null default '',
  description text not null default '',
  actor_id uuid references public.actors (id) on delete restrict,
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  origin public.element_origin not null default 'manual',
  source_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint process_nodes_label_length check (char_length(label) <= 300),
  constraint process_nodes_description_length check (char_length(description) <= 5000),
  constraint process_nodes_source_text_length check (char_length(source_text) <= 5000),
  unique (version_id, element_key)
);

create index process_nodes_element_idx on public.process_nodes (project_id, element_key);

create table public.process_edges (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.process_versions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  element_key uuid not null,
  source_key uuid not null,
  target_key uuid not null,
  label text not null default '',
  condition text not null default '',
  branch public.edge_branch,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint process_edges_no_self_loop check (source_key <> target_key),
  constraint process_edges_label_length check (char_length(label) <= 200),
  constraint process_edges_condition_length check (char_length(condition) <= 2000),
  unique (version_id, element_key),
  foreign key (version_id, source_key) references public.process_nodes (version_id, element_key) on delete cascade,
  foreign key (version_id, target_key) references public.process_nodes (version_id, element_key) on delete cascade
);

-- ---------------------------------------------------------------------------
-- AI analysis runs and findings
-- ---------------------------------------------------------------------------

create table public.process_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  process_id uuid not null references public.processes (id) on delete cascade,
  version_id uuid not null references public.process_versions (id) on delete cascade,
  model text not null,
  prompt_version text not null,
  succeeded boolean not null,
  description_snapshot text not null,
  response jsonb,
  error text,
  usage jsonb,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index process_analysis_runs_version_idx on public.process_analysis_runs (version_id, created_at desc);

create table public.process_findings (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.process_versions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  element_key uuid not null,
  kind public.finding_kind not null,
  statement text not null,
  source_text text,
  origin public.element_origin not null default 'manual',
  status public.finding_status not null default 'draft',
  related_node_keys uuid[] not null default '{}',
  analysis_run_id uuid references public.process_analysis_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint process_findings_statement_length check (char_length(trim(statement)) between 1 and 2000),
  unique (version_id, element_key)
);

-- ---------------------------------------------------------------------------
-- Immutability of non-draft versions
-- ---------------------------------------------------------------------------

create function public.guard_version_content()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version_id uuid := coalesce(new.version_id, old.version_id);
  v_status public.version_status;
begin
  select status into v_status from public.process_versions where id = v_version_id;
  -- The version row itself may already be gone during a cascading delete.
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Version is % and cannot be changed; create a new draft instead', v_status
      using errcode = 'PF423';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger process_nodes_guard before insert or update or delete on public.process_nodes
for each row execute function public.guard_version_content();
create trigger process_edges_guard before insert or update or delete on public.process_edges
for each row execute function public.guard_version_content();
create trigger process_findings_guard before insert or update or delete on public.process_findings
for each row execute function public.guard_version_content();

create function public.guard_version_row()
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
  -- Approved and superseded versions are frozen; the only allowed change is
  -- approved -> superseded when a newer version is approved.
  if old.status = 'approved' and new.status = 'superseded'
     and new.description = old.description and new.revision = old.revision
     and new.approved_by is not distinct from old.approved_by
     and new.approved_at is not distinct from old.approved_at then
    return new;
  end if;
  raise exception 'Version is % and cannot be changed; create a new draft instead', old.status
    using errcode = 'PF423';
end;
$$;

create trigger process_versions_guard before update on public.process_versions
for each row execute function public.guard_version_row();

create trigger processes_touch before update on public.processes
for each row execute function public.touch_updated_at();

create trigger processes_audit after insert or update or delete on public.processes
for each row execute function public.audit_row('project_id');
create trigger process_versions_audit after insert or update on public.process_versions
for each row execute function public.audit_row('project_id');
create trigger actors_audit after insert or update or delete on public.actors
for each row execute function public.audit_row('project_id');

-- ---------------------------------------------------------------------------
-- Structural checks that block approval. The editor runs a richer set of
-- checks (packages/domain validateProcess); these are the ones that must hold
-- for any approved version regardless of which client saved it.
-- ---------------------------------------------------------------------------

create function public.process_structure_errors(p_version_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_errors text[] := '{}';
  v_starts integer;
  v_ends integer;
  v_nodes integer;
  r record;
begin
  select count(*) filter (where node_type = 'start'),
         count(*) filter (where node_type = 'end'),
         count(*)
    into v_starts, v_ends, v_nodes
    from public.process_nodes where version_id = p_version_id;

  if v_nodes = 0 then
    return array['The process map is empty'];
  end if;
  if v_starts = 0 then
    v_errors := v_errors || 'The process has no start event'::text;
  elsif v_starts > 1 then
    v_errors := v_errors || format('The process has %s start events; use exactly one', v_starts);
  end if;
  if v_ends = 0 then
    v_errors := v_errors || 'The process has no end event'::text;
  end if;

  for r in
    select n.label, count(e.id) as outs
      from public.process_nodes n
      left join public.process_edges e on e.version_id = n.version_id and e.source_key = n.element_key
     where n.version_id = p_version_id and n.node_type = 'decision'
     group by n.id, n.label
    having count(e.id) < 2
  loop
    v_errors := v_errors || format('Decision "%s" needs at least two outcomes', r.label);
  end loop;

  if v_starts = 1 then
    for r in
      with recursive reachable(key) as (
        select element_key from public.process_nodes
         where version_id = p_version_id and node_type = 'start'
        union
        select e.target_key from public.process_edges e
          join reachable on e.source_key = reachable.key
         where e.version_id = p_version_id
      )
      select n.label from public.process_nodes n
       where n.version_id = p_version_id
         and n.element_key not in (select key from reachable)
       order by n.label
    loop
      v_errors := v_errors || format('"%s" cannot be reached from the start event', r.label);
    end loop;
  end if;

  return v_errors;
end;
$$;

-- ---------------------------------------------------------------------------
-- Process RPCs
-- ---------------------------------------------------------------------------

create function public.create_process(
  p_project_id uuid,
  p_name text,
  p_process_type public.process_type,
  p_owner text default '',
  p_business_unit text default '',
  p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_process_id uuid;
  v_version_id uuid;
begin
  if not public.has_project_role(p_project_id, array['admin', 'business_analyst']::public.project_role[]) then
    raise exception 'You do not have permission to create processes in this project' using errcode = '42501';
  end if;

  insert into public.processes (project_id, ref_code, name, process_type, owner, business_unit, created_by)
  values (
    p_project_id,
    public.next_ref(p_project_id, 'PRC'),
    trim(p_name),
    p_process_type,
    trim(coalesce(p_owner, '')),
    trim(coalesce(p_business_unit, '')),
    auth.uid()
  )
  returning id into v_process_id;

  insert into public.process_versions (process_id, project_id, version_number, description, created_by, updated_by)
  values (v_process_id, p_project_id, 1, coalesce(p_description, ''), auth.uid(), auth.uid())
  returning id into v_version_id;

  return jsonb_build_object('process_id', v_process_id, 'version_id', v_version_id);
end;
$$;

-- Inserts any actors that do not exist yet (matched case-insensitively) and
-- returns the project's actors with those names.
create function public.ensure_actors(p_project_id uuid, p_actors jsonb)
returns setof public.actors
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_project_role(p_project_id, array['admin', 'business_analyst']::public.project_role[]) then
    raise exception 'You do not have permission to edit actors in this project' using errcode = '42501';
  end if;

  insert into public.actors (project_id, name, kind, created_by)
  select distinct on (lower(trim(a.name))) p_project_id, trim(a.name), coalesce(a.kind, 'role'), auth.uid()
    from jsonb_to_recordset(p_actors) as a(name text, kind public.actor_kind)
   where trim(coalesce(a.name, '')) <> ''
  on conflict (project_id, lower(trim(name))) do nothing;

  return query
    select act.* from public.actors act
     where act.project_id = p_project_id
       and lower(trim(act.name)) in (
         select lower(trim(a.name)) from jsonb_to_recordset(p_actors) as a(name text)
       );
end;
$$;

create function public.save_process_draft(
  p_version_id uuid,
  p_expected_revision integer,
  p_description text,
  p_nodes jsonb,
  p_edges jsonb,
  p_findings jsonb default '[]',
  p_analysis_run_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.process_versions;
  v_unknown_actor uuid;
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
  if v_version.revision <> p_expected_revision then
    raise exception 'This draft was saved by someone else since you opened it (revision % vs %). Reload to see their changes.',
      v_version.revision, p_expected_revision using errcode = 'PF409';
  end if;

  select n.actor_id into v_unknown_actor
    from jsonb_to_recordset(coalesce(p_nodes, '[]')) as n(actor_id uuid)
   where n.actor_id is not null
     and not exists (select 1 from public.actors a where a.id = n.actor_id and a.project_id = v_version.project_id)
   limit 1;
  if v_unknown_actor is not null then
    raise exception 'Actor % does not belong to this project', v_unknown_actor using errcode = 'PF422';
  end if;

  drop table if exists pg_temp._pf_nodes;
  create temporary table _pf_nodes on commit drop as
    select * from jsonb_to_recordset(coalesce(p_nodes, '[]')) as n(
      element_key uuid, node_type public.node_type, label text, description text, actor_id uuid,
      position_x double precision, position_y double precision, origin public.element_origin, source_text text
    );
  drop table if exists pg_temp._pf_edges;
  create temporary table _pf_edges on commit drop as
    select * from jsonb_to_recordset(coalesce(p_edges, '[]')) as e(
      element_key uuid, source_key uuid, target_key uuid, label text, condition text, branch public.edge_branch
    );
  drop table if exists pg_temp._pf_findings;
  create temporary table _pf_findings on commit drop as
    select * from jsonb_to_recordset(coalesce(p_findings, '[]')) as f(
      element_key uuid, kind public.finding_kind, statement text, source_text text,
      origin public.element_origin, status public.finding_status, related_node_keys uuid[]
    );

  if exists (select 1 from pg_temp._pf_nodes where element_key is null or node_type is null)
     or exists (select 1 from pg_temp._pf_edges where element_key is null or source_key is null or target_key is null)
     or exists (select 1 from pg_temp._pf_findings where element_key is null or kind is null or statement is null) then
    raise exception 'Save payload is missing required fields' using errcode = 'PF422';
  end if;
  if (select count(*) <> count(distinct element_key) from pg_temp._pf_nodes)
     or (select count(*) <> count(distinct element_key) from pg_temp._pf_edges)
     or (select count(*) <> count(distinct element_key) from pg_temp._pf_findings) then
    raise exception 'Save payload contains duplicate element keys' using errcode = 'PF422';
  end if;

  -- Remove what the client no longer has. Edges first; node deletes cascade anyway.
  delete from public.process_edges
   where version_id = p_version_id and element_key not in (select element_key from pg_temp._pf_edges);
  delete from public.process_nodes
   where version_id = p_version_id and element_key not in (select element_key from pg_temp._pf_nodes);
  delete from public.process_findings
   where version_id = p_version_id and element_key not in (select element_key from pg_temp._pf_findings);

  update public.process_nodes pn set
    node_type = n.node_type,
    label = coalesce(n.label, ''),
    description = coalesce(n.description, ''),
    actor_id = n.actor_id,
    position_x = coalesce(n.position_x, 0),
    position_y = coalesce(n.position_y, 0),
    origin = coalesce(n.origin, pn.origin),
    source_text = n.source_text,
    updated_at = now()
  from pg_temp._pf_nodes n
  where pn.version_id = p_version_id and pn.element_key = n.element_key
    and (pn.node_type, pn.label, pn.description, pn.actor_id, pn.position_x, pn.position_y, pn.origin, pn.source_text)
        is distinct from
        (n.node_type, coalesce(n.label, ''), coalesce(n.description, ''), n.actor_id,
         coalesce(n.position_x, 0), coalesce(n.position_y, 0), coalesce(n.origin, pn.origin), n.source_text);

  -- New nodes keep the ref code of the same element in another version of
  -- this project (e.g. a node deleted and restored), otherwise get a new one.
  insert into public.process_nodes (
    version_id, project_id, element_key, ref_code, node_type, label, description, actor_id,
    position_x, position_y, origin, source_text
  )
  select
    p_version_id, v_version.project_id, n.element_key,
    coalesce(
      (select o.ref_code from public.process_nodes o
        where o.project_id = v_version.project_id and o.element_key = n.element_key and o.ref_code is not null
        limit 1),
      public.next_ref(
        v_version.project_id,
        case n.node_type when 'decision' then 'DEC' when 'start' then 'EVT' when 'end' then 'EVT' else 'ACT' end
      )
    ),
    n.node_type, coalesce(n.label, ''), coalesce(n.description, ''), n.actor_id,
    coalesce(n.position_x, 0), coalesce(n.position_y, 0), coalesce(n.origin, 'manual'), n.source_text
  from pg_temp._pf_nodes n
  where not exists (
    select 1 from public.process_nodes pn where pn.version_id = p_version_id and pn.element_key = n.element_key
  );

  update public.process_edges pe set
    source_key = e.source_key,
    target_key = e.target_key,
    label = coalesce(e.label, ''),
    condition = coalesce(e.condition, ''),
    branch = e.branch,
    updated_at = now()
  from pg_temp._pf_edges e
  where pe.version_id = p_version_id and pe.element_key = e.element_key
    and (pe.source_key, pe.target_key, pe.label, pe.condition, pe.branch)
        is distinct from (e.source_key, e.target_key, coalesce(e.label, ''), coalesce(e.condition, ''), e.branch);

  insert into public.process_edges (version_id, project_id, element_key, source_key, target_key, label, condition, branch)
  select p_version_id, v_version.project_id, e.element_key, e.source_key, e.target_key,
         coalesce(e.label, ''), coalesce(e.condition, ''), e.branch
    from pg_temp._pf_edges e
   where not exists (
     select 1 from public.process_edges pe where pe.version_id = p_version_id and pe.element_key = e.element_key
   );

  insert into public.process_findings (
    version_id, project_id, element_key, kind, statement, source_text, origin, status, related_node_keys, analysis_run_id
  )
  select p_version_id, v_version.project_id, f.element_key, f.kind, f.statement, f.source_text,
         coalesce(f.origin, 'manual'), coalesce(f.status, 'draft'), coalesce(f.related_node_keys, '{}'),
         case when coalesce(f.origin, 'manual') <> 'manual' then p_analysis_run_id end
    from pg_temp._pf_findings f
  on conflict (version_id, element_key) do update set
    kind = excluded.kind,
    statement = excluded.statement,
    source_text = excluded.source_text,
    status = excluded.status,
    related_node_keys = excluded.related_node_keys,
    updated_at = now();

  if p_analysis_run_id is not null then
    update public.process_analysis_runs set accepted_at = coalesce(accepted_at, now())
     where id = p_analysis_run_id and version_id = p_version_id;
  end if;

  update public.process_versions set
    description = coalesce(p_description, ''),
    revision = revision + 1,
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_version_id;

  insert into public.audit_log (project_id, table_name, record_id, action, actor_id, new_data)
  values (
    v_version.project_id, 'process_versions', p_version_id, 'save_draft', auth.uid(),
    jsonb_build_object(
      'revision', v_version.revision + 1,
      'nodes', jsonb_array_length(coalesce(p_nodes, '[]')),
      'edges', jsonb_array_length(coalesce(p_edges, '[]')),
      'findings', jsonb_array_length(coalesce(p_findings, '[]')),
      'analysis_run_id', p_analysis_run_id
    )
  );

  return v_version.revision + 1;
end;
$$;

create function public.approve_process_version(p_version_id uuid, p_expected_revision integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.process_versions;
  v_errors text[];
begin
  select * into v_version from public.process_versions where id = p_version_id for update;
  if not found then
    raise exception 'Process version not found' using errcode = 'P0002';
  end if;
  if not public.has_project_role(v_version.project_id, array['admin', 'product_owner']::public.project_role[]) then
    raise exception 'Only a Product Owner or Administrator can approve a process' using errcode = '42501';
  end if;
  if v_version.status <> 'draft' then
    raise exception 'Version % is already %', v_version.version_number, v_version.status using errcode = 'PF423';
  end if;
  if v_version.revision <> p_expected_revision then
    raise exception 'This draft changed since you reviewed it. Reload and review it again before approving.'
      using errcode = 'PF409';
  end if;

  v_errors := public.process_structure_errors(p_version_id);
  if cardinality(v_errors) > 0 then
    raise exception 'The process cannot be approved: %', array_to_string(v_errors, '; ') using errcode = 'PF422';
  end if;

  update public.process_versions set status = 'superseded'
   where process_id = v_version.process_id and status = 'approved';

  update public.process_versions set
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = now()
  where id = p_version_id;
end;
$$;

create function public.create_draft_from_version(p_version_id uuid)
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

  -- Serialise concurrent requests for the same process.
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

  return v_new_id;
end;
$$;
