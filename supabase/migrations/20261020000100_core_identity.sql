-- ProductFlow AI: identity, projects, membership, identifiers and audit.
--
-- Security model: every table has row level security. Access is granted by
-- project membership and the member's project role. Multi-step workflow
-- writes go through SECURITY DEFINER functions that check the caller's role
-- themselves; those functions always pin search_path to ''.

create type public.project_role as enum (
  'admin',
  'product_owner',
  'business_analyst',
  'developer',
  'business_user'
);

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 120)
);

-- Users without an email (e.g. phone sign-in) are stored with an empty email.
create unique index profiles_email_key on public.profiles (lower(email)) where email <> '';

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'User'
      ),
      120
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Projects and membership
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  description text not null default '',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_key_format check (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  constraint projects_name_length check (char_length(trim(name)) between 1 and 200),
  constraint projects_description_length check (char_length(description) <= 4000)
);

create unique index projects_key_unique on public.projects (key);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.project_role not null,
  added_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members (user_id);

-- Membership helpers used by RLS policies. SECURITY DEFINER so policies on
-- project_members itself do not recurse.
create function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid()
  );
$$;

create function public.has_project_role(p_project_id uuid, p_roles public.project_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid() and role = any (p_roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- Human-readable identifiers, e.g. PRC-001, ACT-014 (unique per project)
-- ---------------------------------------------------------------------------

create table public.id_counters (
  project_id uuid not null references public.projects (id) on delete cascade,
  prefix text not null,
  last_value integer not null default 0,
  primary key (project_id, prefix)
);

create function public.next_ref(p_project_id uuid, p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  insert into public.id_counters as c (project_id, prefix, last_value)
  values (p_project_id, p_prefix, 1)
  on conflict (project_id, prefix) do update set last_value = c.last_value + 1
  returning last_value into v_next;
  return p_prefix || '-' || lpad(v_next::text, 3, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  project_id uuid references public.projects (id) on delete cascade,
  table_name text not null,
  record_id uuid,
  action text not null,
  actor_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_project_idx on public.audit_log (project_id, created_at desc);
create index audit_log_record_idx on public.audit_log (record_id);

-- Generic row audit trigger. TG_ARGV[0] names the column holding the project id.
create function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (project_id, table_name, record_id, action, actor_id, old_data, new_data)
  values (
    (v_row ->> tg_argv[0])::uuid,
    tg_table_name,
    case when v_row ? 'id' then (v_row ->> 'id')::uuid end,
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_touch before update on public.projects
for each row execute function public.touch_updated_at();

create trigger projects_audit after insert or update or delete on public.projects
for each row execute function public.audit_row('id');

-- project_members has a composite key, so audit it with its own trigger.
create function public.audit_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (project_id, table_name, record_id, action, actor_id, old_data, new_data)
  values (
    coalesce(new.project_id, old.project_id),
    tg_table_name,
    coalesce(new.user_id, old.user_id),
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger project_members_audit after insert or update or delete on public.project_members
for each row execute function public.audit_member();

-- ---------------------------------------------------------------------------
-- Project RPCs
-- ---------------------------------------------------------------------------

create function public.create_project(p_key text, p_name text, p_description text default '')
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_project public.projects;
begin
  if v_user is null then
    raise exception 'You must be signed in to create a project' using errcode = '42501';
  end if;

  insert into public.projects (key, name, description, created_by)
  values (upper(trim(p_key)), trim(p_name), coalesce(p_description, ''), v_user)
  returning * into v_project;

  insert into public.project_members (project_id, user_id, role, added_by)
  values (v_project.id, v_user, 'admin', v_user);

  return v_project;
exception
  when unique_violation then
    raise exception 'A project with key % already exists', upper(trim(p_key)) using errcode = 'PF409';
end;
$$;

create function public.add_project_member(p_project_id uuid, p_email text, p_role public.project_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.has_project_role(p_project_id, array['admin']::public.project_role[]) then
    raise exception 'Only project administrators can manage members' using errcode = '42501';
  end if;

  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No user with email % has signed up yet', trim(p_email) using errcode = 'P0002';
  end if;

  if exists (select 1 from public.project_members where project_id = p_project_id and user_id = v_user) then
    raise exception '% is already a member of this project', trim(p_email) using errcode = 'PF409';
  end if;

  insert into public.project_members (project_id, user_id, role, added_by)
  values (p_project_id, v_user, p_role, auth.uid());
end;
$$;

-- Raises if the change would leave the project without an administrator.
create function public.assert_admin_remains(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and role = 'admin' and user_id <> p_user_id
  ) then
    raise exception 'A project must keep at least one administrator' using errcode = 'PF422';
  end if;
end;
$$;

create function public.update_member_role(p_project_id uuid, p_user_id uuid, p_role public.project_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_project_role(p_project_id, array['admin']::public.project_role[]) then
    raise exception 'Only project administrators can manage members' using errcode = '42501';
  end if;
  if p_role <> 'admin' then
    perform public.assert_admin_remains(p_project_id, p_user_id);
  end if;
  update public.project_members set role = p_role
  where project_id = p_project_id and user_id = p_user_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.remove_project_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_project_role(p_project_id, array['admin']::public.project_role[]) then
    raise exception 'Only project administrators can manage members' using errcode = '42501';
  end if;
  perform public.assert_admin_remains(p_project_id, p_user_id);
  delete from public.project_members where project_id = p_project_id and user_id = p_user_id;
end;
$$;
