-- Process creation, draft saving, optimistic locking, approval and versioning.
begin;

select tests.create_user('alice') is not null;  -- admin
select tests.create_user('bob') is not null;    -- business analyst
select tests.create_user('carol') is not null;  -- developer
select tests.create_user('erin') is not null;   -- product owner
select tests.create_user('mallory') is not null;

select tests.authenticate('alice');
set local role authenticated;
select (public.create_project('DWO', 'Debt Write-Off')).id as project_id \gset
select public.add_project_member(:'project_id', 'bob@example.com', 'business_analyst');
select public.add_project_member(:'project_id', 'carol@example.com', 'developer');
select public.add_project_member(:'project_id', 'erin@example.com', 'product_owner');
reset role;

-- ---------------------------------------------------------------------------
-- Creating processes
-- ---------------------------------------------------------------------------
select tests.authenticate('carol');
set local role authenticated;
select tests.throws(format($$select public.create_process(%L, 'Nope', 'as_is')$$, :'project_id'),
  '42501', 'developers cannot create processes');
reset role;

select tests.authenticate('bob');
set local role authenticated;
select r ->> 'process_id' as process_id, r ->> 'version_id' as v1
  from public.create_process(:'project_id', 'Debt write-off', 'to_be', 'Head of Finance', 'Finance', 'When a Finance Officer...') r \gset
select tests.ok((select ref_code from public.processes where id = :'process_id') = 'PRC-001', 'processes get a sequential ref code');
select tests.ok((select status = 'draft' and version_number = 1 and revision = 1 from public.process_versions where id = :'v1'),
  'a new process starts with draft version 1');

-- Actors are created once and matched case-insensitively.
select count(*) as actor_count from public.ensure_actors(:'project_id',
  '[{"name":"Finance Officer","kind":"role"},{"name":"supervisor","kind":"role"},{"name":"Debt System","kind":"system"}]') \gset
select tests.ok(:actor_count = 3, 'ensure_actors creates missing actors');
select count(*) as actor_count from public.ensure_actors(:'project_id', '[{"name":"FINANCE OFFICER","kind":"role"}]') \gset
select tests.ok(:actor_count = 1 and (select count(*) from public.actors) = 3, 'ensure_actors reuses existing actors');
select id as officer from public.actors where name = 'Finance Officer' \gset
select id as supervisor from public.actors where name = 'supervisor' \gset

-- ---------------------------------------------------------------------------
-- Saving drafts
-- ---------------------------------------------------------------------------
select gen_random_uuid() as n_start, gen_random_uuid() as n_check, gen_random_uuid() as n_review,
       gen_random_uuid() as n_end, gen_random_uuid() as n_orphan,
       gen_random_uuid() as e1, gen_random_uuid() as e2, gen_random_uuid() as e3, gen_random_uuid() as e4,
       gen_random_uuid() as f1 \gset

select public.save_process_draft(
  :'v1', 1, 'Updated description',
  jsonb_build_array(
    jsonb_build_object('element_key', :'n_start', 'node_type', 'start', 'label', 'Start', 'position_x', 0, 'position_y', 0, 'origin', 'inferred'),
    jsonb_build_object('element_key', :'n_check', 'node_type', 'decision', 'label', 'Older than 5 years?', 'actor_id', :'officer', 'position_x', 100, 'position_y', 0, 'origin', 'stated', 'source_text', 'more than five years'),
    jsonb_build_object('element_key', :'n_review', 'node_type', 'approval', 'label', 'Supervisor review', 'actor_id', :'supervisor', 'position_x', 200, 'position_y', 0),
    jsonb_build_object('element_key', :'n_end', 'node_type', 'end', 'label', 'End', 'position_x', 300, 'position_y', 0)
  ),
  jsonb_build_array(
    jsonb_build_object('element_key', :'e1', 'source_key', :'n_start', 'target_key', :'n_check'),
    jsonb_build_object('element_key', :'e2', 'source_key', :'n_check', 'target_key', :'n_review', 'branch', 'yes', 'label', 'Yes')
  ),
  jsonb_build_array(
    jsonb_build_object('element_key', :'f1', 'kind', 'business_rule', 'statement', 'Debt must be older than five years', 'origin', 'stated', 'status', 'draft', 'related_node_keys', jsonb_build_array(:'n_check'))
  )
) as rev \gset
select tests.ok(:rev = 2, 'saving returns the new revision');
select tests.ok((select description from public.process_versions where id = :'v1') = 'Updated description', 'the description is saved');
select tests.ok((select count(*) from public.process_nodes where version_id = :'v1') = 4, 'nodes are saved');
select tests.ok((select string_agg(ref_code, ',' order by position_x) from public.process_nodes where version_id = :'v1') = 'EVT-001,DEC-001,ACT-001,EVT-002',
  'nodes get ref codes by type');
select tests.ok((select related_node_keys = array[:'n_check'::uuid] from public.process_findings where element_key = :'f1'), 'findings keep node links');

select tests.throws(format($$select public.save_process_draft(%L, 1, '', '[]', '[]')$$, :'v1'),
  'PF409', 'a save with a stale revision is rejected');
select tests.throws(format($$select public.save_process_draft(%L, 2, '', %L, '[]')$$, :'v1',
  jsonb_build_array(jsonb_build_object('element_key', gen_random_uuid(), 'node_type', 'activity', 'actor_id', gen_random_uuid()))),
  'PF422', 'nodes cannot reference actors from outside the project');
select tests.throws(format($$select public.save_process_draft(%L, 2, '', %L, %L)$$, :'v1',
  jsonb_build_array(jsonb_build_object('element_key', :'n_start', 'node_type', 'start')),
  jsonb_build_array(jsonb_build_object('element_key', gen_random_uuid(), 'source_key', :'n_start', 'target_key', gen_random_uuid()))),
  '23503', 'edges must point at nodes in the same version');
select tests.throws(format($$select public.save_process_draft(%L, 2, '', %L, '[]')$$, :'v1',
  jsonb_build_array(jsonb_build_object('element_key', :'n_start', 'node_type', 'start'), jsonb_build_object('element_key', :'n_start', 'node_type', 'end'))),
  'PF422', 'duplicate element keys are rejected');

-- Second save: rename, add an orphan node, connect the review to the end, keep ids stable.
select id as check_row_id from public.process_nodes where element_key = :'n_check' \gset
select public.save_process_draft(
  :'v1', 2, 'Updated description',
  jsonb_build_array(
    jsonb_build_object('element_key', :'n_start', 'node_type', 'start', 'label', 'Start', 'position_x', 0, 'position_y', 0, 'origin', 'inferred'),
    jsonb_build_object('element_key', :'n_check', 'node_type', 'decision', 'label', 'Outstanding > 5 years?', 'actor_id', :'officer', 'position_x', 100, 'position_y', 0, 'origin', 'stated'),
    jsonb_build_object('element_key', :'n_review', 'node_type', 'approval', 'label', 'Supervisor review', 'actor_id', :'supervisor', 'position_x', 200, 'position_y', 0),
    jsonb_build_object('element_key', :'n_end', 'node_type', 'end', 'label', 'End', 'position_x', 300, 'position_y', 0),
    jsonb_build_object('element_key', :'n_orphan', 'node_type', 'activity', 'label', 'Orphan', 'position_x', 400, 'position_y', 0)
  ),
  jsonb_build_array(
    jsonb_build_object('element_key', :'e1', 'source_key', :'n_start', 'target_key', :'n_check'),
    jsonb_build_object('element_key', :'e2', 'source_key', :'n_check', 'target_key', :'n_review', 'branch', 'yes', 'label', 'Yes'),
    jsonb_build_object('element_key', :'e3', 'source_key', :'n_review', 'target_key', :'n_end')
  ),
  '[]'
) as rev \gset
select tests.ok(:rev = 3, 'second save increments the revision');
select tests.ok((select id from public.process_nodes where element_key = :'n_check') = :'check_row_id', 'unchanged elements keep their row id');
select tests.ok((select label from public.process_nodes where element_key = :'n_check') = 'Outstanding > 5 years?', 'renames are saved');
select tests.ok((select count(*) from public.process_findings where version_id = :'v1') = 0, 'findings removed by the client are deleted');
reset role;

-- Developers can read but not save; outsiders cannot read.
select tests.authenticate('carol');
set local role authenticated;
select tests.ok((select count(*) from public.process_nodes where version_id = :'v1') = 5, 'developers can read process maps');
select tests.throws(format($$select public.save_process_draft(%L, 3, 'x', '[]', '[]')$$, :'v1'),
  '42501', 'developers cannot save drafts');
select tests.throws($$update public.process_nodes set label = 'direct' $$, '42501', 'nodes cannot be updated directly');
select tests.throws(format($$insert into public.process_analysis_runs (project_id, process_id, version_id, model, prompt_version, succeeded, description_snapshot) values (%L, %L, %L, 'm', 'p', true, '')$$,
  :'project_id', :'process_id', :'v1'), '42501', 'developers cannot record analysis runs');
reset role;

select tests.authenticate('mallory');
set local role authenticated;
select tests.ok((select count(*) from public.process_nodes) = 0, 'outsiders cannot read process maps');
select tests.ok((select count(*) from public.processes) = 0, 'outsiders cannot read processes');
select tests.throws(format($$select public.save_process_draft(%L, 3, 'x', '[]', '[]')$$, :'v1'),
  '42501', 'outsiders cannot save drafts');
reset role;

-- ---------------------------------------------------------------------------
-- Approval
-- ---------------------------------------------------------------------------
select tests.authenticate('bob');
set local role authenticated;
select tests.throws(format($$select public.approve_process_version(%L, 3)$$, :'v1'),
  '42501', 'business analysts cannot approve');
insert into public.process_analysis_runs (project_id, process_id, version_id, model, prompt_version, succeeded, description_snapshot)
values (:'project_id', :'process_id', :'v1', 'claude', 'process-analysis/v1', true, 'snapshot') returning id as run_id \gset
select tests.ok(:'run_id' is not null, 'analysts can record analysis runs');
reset role;

select tests.authenticate('erin');
set local role authenticated;
select tests.throws(format($$select public.approve_process_version(%L, 3)$$, :'v1'),
  'PF422', 'structural errors block approval (orphan node, single-outcome decision)');
reset role;

-- Bob fixes the map: removes the orphan and adds the No branch.
select tests.authenticate('bob');
set local role authenticated;
select public.save_process_draft(
  :'v1', 3, 'Updated description',
  jsonb_build_array(
    jsonb_build_object('element_key', :'n_start', 'node_type', 'start', 'label', 'Start'),
    jsonb_build_object('element_key', :'n_check', 'node_type', 'decision', 'label', 'Outstanding > 5 years?', 'actor_id', :'officer', 'origin', 'stated'),
    jsonb_build_object('element_key', :'n_review', 'node_type', 'approval', 'label', 'Supervisor review', 'actor_id', :'supervisor'),
    jsonb_build_object('element_key', :'n_end', 'node_type', 'end', 'label', 'End')
  ),
  jsonb_build_array(
    jsonb_build_object('element_key', :'e1', 'source_key', :'n_start', 'target_key', :'n_check'),
    jsonb_build_object('element_key', :'e2', 'source_key', :'n_check', 'target_key', :'n_review', 'branch', 'yes', 'label', 'Yes'),
    jsonb_build_object('element_key', :'e3', 'source_key', :'n_review', 'target_key', :'n_end'),
    jsonb_build_object('element_key', :'e4', 'source_key', :'n_check', 'target_key', :'n_end', 'branch', 'no', 'label', 'No')
  ),
  jsonb_build_array(
    jsonb_build_object('element_key', :'f1', 'kind', 'business_rule', 'statement', 'Debt must be older than five years', 'origin', 'stated', 'status', 'accepted', 'related_node_keys', jsonb_build_array(:'n_check'))
  ),
  :'run_id'
) as rev \gset
select tests.ok((select accepted_at is not null from public.process_analysis_runs where id = :'run_id'), 'saving with a run id marks the run accepted');
select tests.ok((select analysis_run_id = :'run_id' from public.process_findings where element_key = :'f1'), 'AI findings are linked to their run');
reset role;

select tests.authenticate('erin');
set local role authenticated;
select tests.throws(format($$select public.approve_process_version(%L, 3)$$, :'v1'),
  'PF409', 'approving a revision other than the one reviewed is rejected');
select public.approve_process_version(:'v1', 4);
select tests.ok((select status = 'approved' and approved_by = tests.uid('erin') from public.process_versions where id = :'v1'),
  'a product owner can approve a valid draft');
reset role;

-- ---------------------------------------------------------------------------
-- Approved versions are frozen; changes go into a new draft
-- ---------------------------------------------------------------------------
select tests.authenticate('bob');
set local role authenticated;
select tests.throws(format($$select public.save_process_draft(%L, 4, 'overwrite', '[]', '[]')$$, :'v1'),
  'PF423', 'approved versions cannot be saved over');
reset role;
-- Even the table owner cannot alter approved content.
select tests.throws(format($$update public.process_nodes set label = 'tampered' where version_id = %L$$, :'v1'),
  'PF423', 'triggers block changes to approved nodes, even for privileged roles');
select tests.throws(format($$update public.process_versions set description = 'tampered' where id = %L$$, :'v1'),
  'PF423', 'triggers block changes to approved versions');

select tests.authenticate('bob');
set local role authenticated;
select public.create_draft_from_version(:'v1') as v2 \gset
select tests.ok((select version_number = 2 and status = 'draft' and based_on_version_id = :'v1' from public.process_versions where id = :'v2'),
  'a new draft is created as version 2');
select tests.ok(
  (select array_agg(element_key || ref_code order by element_key) from public.process_nodes where version_id = :'v2')
  = (select array_agg(element_key || ref_code order by element_key) from public.process_nodes where version_id = :'v1'),
  'the new draft keeps element keys and ref codes');
select tests.ok((select count(*) from public.process_edges where version_id = :'v2') = 4, 'connections are copied');
select tests.ok((select count(*) from public.process_findings where version_id = :'v2') = 1, 'findings are copied');
select tests.throws(format($$select public.create_draft_from_version(%L)$$, :'v1'),
  'PF409', 'only one draft per process can be open');

-- Delete a node in v2 and restore it: it keeps its ref code.
select public.save_process_draft(:'v2', 1, 'v2', jsonb_build_array(
    jsonb_build_object('element_key', :'n_start', 'node_type', 'start', 'label', 'Start')), '[]', '[]') as rev \gset
select public.save_process_draft(:'v2', 2, 'v2', jsonb_build_array(
    jsonb_build_object('element_key', :'n_start', 'node_type', 'start', 'label', 'Start'),
    jsonb_build_object('element_key', :'n_review', 'node_type', 'approval', 'label', 'Supervisor review')), '[]', '[]') as rev \gset
select tests.ok((select ref_code from public.process_nodes where version_id = :'v2' and element_key = :'n_review') = 'ACT-001',
  'a restored element keeps its original ref code');
select tests.ok((select count(*) from public.process_nodes where version_id = :'v1') = 4, 'editing the new draft leaves version 1 untouched');
reset role;

-- Approving v2 supersedes v1. v2 is currently invalid, so restore the full map first.
select tests.authenticate('bob');
set local role authenticated;
select public.save_process_draft(:'v2', 3, 'v2',
  (select jsonb_agg(jsonb_build_object('element_key', element_key, 'node_type', node_type, 'label', label, 'actor_id', actor_id)) from public.process_nodes where version_id = :'v1'),
  (select jsonb_agg(jsonb_build_object('element_key', element_key, 'source_key', source_key, 'target_key', target_key, 'branch', branch)) from public.process_edges where version_id = :'v1'),
  '[]') as rev \gset
reset role;
select tests.authenticate('erin');
set local role authenticated;
select public.approve_process_version(:'v2', 4);
select tests.ok((select status from public.process_versions where id = :'v1') = 'superseded', 'approving v2 supersedes v1');
select tests.ok((select status from public.process_versions where id = :'v2') = 'approved', 'v2 is approved');
select tests.ok((select count(*) from public.process_versions where process_id = :'process_id') = 2, 'no version was overwritten');
reset role;

select tests.throws(format($$update public.process_versions set status = 'approved' where id = %L$$, :'v1'),
  'PF423', 'a superseded version cannot be re-approved directly');
select tests.ok((select count(*) from public.audit_log where record_id = :'v1' and action = 'save_draft') = 3, 'draft saves are audited');

-- Metadata edits are allowed for analysts and recorded in the audit log.
select tests.authenticate('bob');
set local role authenticated;
update public.processes set owner = 'CFO', business_unit = 'Treasury' where id = :'process_id';
select tests.ok((select owner from public.processes where id = :'process_id') = 'CFO', 'analysts can edit process details');
select tests.throws(format($$update public.processes set ref_code = 'PRC-999' where id = %L$$, :'process_id'),
  '42501', 'ref codes cannot be changed by clients');
reset role;

rollback;
