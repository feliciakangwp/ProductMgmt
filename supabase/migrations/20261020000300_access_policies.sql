-- ProductFlow AI: row level security, grants and function privileges.
--
-- Reads: any member of a project can read its data.
-- Writes: simple edits are allowed by RLS for the roles listed below; all
-- versioned or multi-row writes (process creation, saving drafts, approval,
-- membership) are only possible through the SECURITY DEFINER functions.

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.id_counters enable row level security;
alter table public.audit_log enable row level security;
alter table public.actors enable row level security;
alter table public.processes enable row level security;
alter table public.process_versions enable row level security;
alter table public.process_nodes enable row level security;
alter table public.process_edges enable row level security;
alter table public.process_analysis_runs enable row level security;
alter table public.process_findings enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges. Anonymous users get nothing; authenticated users get the
-- minimum each table needs, then RLS narrows it to their projects.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;

grant select on public.profiles, public.projects, public.project_members, public.audit_log,
  public.actors, public.processes, public.process_versions, public.process_nodes,
  public.process_edges, public.process_analysis_runs, public.process_findings
  to authenticated;

grant update (display_name) on public.profiles to authenticated;
grant update (name, description) on public.projects to authenticated;
grant insert (project_id, name, kind, description) on public.actors to authenticated;
grant update (name, kind, description) on public.actors to authenticated;
grant update (name, process_type, owner, business_unit) on public.processes to authenticated;
grant insert (project_id, process_id, version_id, model, prompt_version, succeeded,
  description_snapshot, response, error, usage) on public.process_analysis_runs to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy profiles_select on public.profiles for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1 from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);

create policy profiles_update_own on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy projects_select on public.projects for select to authenticated
using (public.is_project_member(id));

create policy projects_update on public.projects for update to authenticated
using (public.has_project_role(id, array['admin']::public.project_role[]))
with check (public.has_project_role(id, array['admin']::public.project_role[]));

create policy project_members_select on public.project_members for select to authenticated
using (public.is_project_member(project_id));

create policy audit_log_select on public.audit_log for select to authenticated
using (public.has_project_role(project_id, array['admin', 'product_owner']::public.project_role[]));

create policy actors_select on public.actors for select to authenticated
using (public.is_project_member(project_id));

create policy actors_insert on public.actors for insert to authenticated
with check (public.has_project_role(project_id, array['admin', 'business_analyst']::public.project_role[]));

create policy actors_update on public.actors for update to authenticated
using (public.has_project_role(project_id, array['admin', 'business_analyst']::public.project_role[]))
with check (public.has_project_role(project_id, array['admin', 'business_analyst']::public.project_role[]));

create policy processes_select on public.processes for select to authenticated
using (public.is_project_member(project_id));

create policy processes_update on public.processes for update to authenticated
using (public.has_project_role(project_id, array['admin', 'business_analyst']::public.project_role[]))
with check (public.has_project_role(project_id, array['admin', 'business_analyst']::public.project_role[]));

create policy process_versions_select on public.process_versions for select to authenticated
using (public.is_project_member(project_id));

create policy process_nodes_select on public.process_nodes for select to authenticated
using (public.is_project_member(project_id));

create policy process_edges_select on public.process_edges for select to authenticated
using (public.is_project_member(project_id));

create policy process_findings_select on public.process_findings for select to authenticated
using (public.is_project_member(project_id));

create policy process_analysis_runs_select on public.process_analysis_runs for select to authenticated
using (public.is_project_member(project_id));

-- The run must belong to a version of a process in the same project, so a
-- caller cannot attach runs to another project's process.
create policy process_analysis_runs_insert on public.process_analysis_runs for insert to authenticated
with check (
  public.has_project_role(project_id, array['admin', 'business_analyst']::public.project_role[])
  and created_by = auth.uid()
  and exists (
    select 1 from public.process_versions v
    where v.id = version_id and v.process_id = process_analysis_runs.process_id
      and v.project_id = process_analysis_runs.project_id
  )
);

-- ---------------------------------------------------------------------------
-- Function privileges. PostgreSQL grants EXECUTE to PUBLIC by default; revoke
-- it everywhere, then grant the RPCs the app calls to authenticated users.
-- Internal helpers stay callable only by their owner (and from policies and
-- SECURITY DEFINER functions, which run as the owner).
-- ---------------------------------------------------------------------------

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
  public.create_draft_from_version(uuid)
  to authenticated;

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
