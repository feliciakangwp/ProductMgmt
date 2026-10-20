-- Delivery tables: members read, nobody writes directly, the service role
-- writes, and the guards keep test history and original estimates intact.
begin;

-- The assertion helpers are normally used as authenticated; let the service role call them too.
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

select tests.create_user('alice') is not null;  -- admin
select tests.create_user('dave') is not null;   -- developer
select tests.create_user('mallory') is not null;

select tests.authenticate('alice');
set local role authenticated;
select (public.create_project('DLV', 'Delivery')).id as project_id \gset
select public.add_project_member(:'project_id', 'dave@example.com', 'developer');
reset role;
select tests.uid('alice') as alice, tests.uid('dave') as dave \gset

-- The service role writes on behalf of the delivery service.
set local role service_role;
select public.next_ref(:'project_id', 'US') = 'US-001' as first_ref \gset
select tests.ok(:'first_ref'::boolean, 'the service role can issue ref codes');
insert into public.stories (id, project_id, ref_code, story_type, title, status, origin, design_status, priority, work_status,
  created_by, created_at, updated_at, revision, acceptance_criteria)
values (gen_random_uuid(), :'project_id', 'US-001', 'functional', 'Submit a write-off request', 'in_backlog', 'manual', 'confirmed',
  'high', 'todo', :'alice', now(), now(), 1, '[{"id":"a","text":"Given…"}]')
returning id as story_id \gset
insert into public.business_scenarios (id, project_id, ref_code, title, scenario_type, status, origin, version, created_by,
  created_at, updated_at, revision, steps)
values (gen_random_uuid(), :'project_id', 'BS-001', 'Main flow', 'main', 'approved', 'manual', 1, :'alice', now(), now(), 1,
  '[{"id":"s1","action":"Submit","inputData":"","expectedBehaviour":"","expectedResult":"Saved"}]')
returning id as scenario_id \gset
insert into public.test_executions (id, project_id, ref_code, scenario_id, scenario_version, steps, results, status, tester_id,
  started_at, revision)
values (gen_random_uuid(), :'project_id', 'TE-001', :'scenario_id', 1, '[]', '[]', 'failed', :'alice', now(), 1)
returning id as execution_id \gset
insert into public.delivery_events (id, project_id, entity_type, entity_id, kind, actor_id, created_at)
values (gen_random_uuid(), :'project_id', 'story', :'story_id', 'created', :'alice', now()) returning id as event_id \gset

-- Guards
update public.stories set estimate_hours = 8, original_estimate_hours = 8 where id = :'story_id';
select tests.throws(format('update public.stories set original_estimate_hours = 12 where id = %L', :'story_id'),
  'PF423', 'the original estimate cannot be overwritten');
update public.stories set estimate_hours = 12 where id = :'story_id';
select tests.ok((select estimate_hours = 12 and original_estimate_hours = 8 from public.stories where id = :'story_id'),
  'the current estimate can change while the original is kept');
select tests.throws(format($$update public.stories set ref_code = 'US-999' where id = %L$$, :'story_id'),
  'PF423', 'a story''s ref code cannot change');
select tests.throws(format($$update public.test_executions set remarks = 'edited' where id = %L$$, :'execution_id'),
  'PF423', 'completed test executions cannot be changed');
select tests.throws(format('delete from public.test_executions where id = %L', :'execution_id'),
  'PF423', 'test history cannot be deleted');
select tests.throws(format($$update public.delivery_events set body = 'x' where id = %L$$, :'event_id'),
  '42501', 'the history log cannot be edited');
select tests.throws(format($$insert into public.stories (id, project_id, ref_code, story_type, title, status, origin, design_status,
  priority, work_status, created_by, created_at, updated_at, revision, behaviour)
  values (gen_random_uuid(), %L, 'US-002', 'functional', 'Bad', 'draft', 'manual', 'confirmed', 'low', 'todo', %L, now(), now(), 1, '{}')$$,
  :'project_id', :'alice'), '23514', 'list columns must hold JSON arrays');
select tests.throws(format($$insert into public.stories (id, project_id, ref_code, story_type, title, status, origin, design_status,
  priority, work_status, created_by, created_at, updated_at, revision)
  values (gen_random_uuid(), %L, 'US-003', 'functional', 'Bad', 'done', 'manual', 'confirmed', 'low', 'todo', %L, now(), now(), 1)$$,
  :'project_id', :'alice'), '23514', 'statuses are checked');
insert into public.ai_task_runs (project_id, task, subject_id, model, prompt_version, succeeded, input, created_by)
values (:'project_id', 'story_generation', :'story_id', 'claude', 'story-generation/v1', true, '{}', :'alice');
select tests.ok(true, 'AI runs record delivery task names');
reset role;

-- Members read; nobody writes directly.
select tests.authenticate('dave');
set local role authenticated;
select tests.ok((select count(*) from public.stories) = 1, 'a member can read the project''s stories');
select tests.ok((select count(*) from public.test_executions) = 1, 'a member can read test history');
select tests.throws(format($$update public.stories set title = 'Direct edit' where id = %L$$, :'story_id'),
  '42501', 'members cannot update stories directly');
select tests.throws(format($$insert into public.delivery_events (id, project_id, entity_type, entity_id, kind, actor_id, created_at)
  values (gen_random_uuid(), %L, 'story', %L, 'comment', %L, now())$$, :'project_id', :'story_id', :'dave'),
  '42501', 'members cannot write history directly');
select tests.throws(format($$select public.next_ref(%L, 'US')$$, :'project_id'), '42501', 'members cannot issue ref codes');
reset role;

select tests.authenticate('mallory');
set local role authenticated;
select tests.ok((select count(*) from public.stories) = 0, 'non-members see no stories');
select tests.ok((select count(*) from public.delivery_events) = 0, 'non-members see no history');
reset role;

rollback;
