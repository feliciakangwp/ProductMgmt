-- Data dictionary, validation rules, business rules and activity inputs/outputs.
begin;

select tests.create_user('alice') is not null;  -- admin
select tests.create_user('bob') is not null;    -- business analyst
select tests.create_user('carol') is not null;  -- developer
select tests.create_user('erin') is not null;   -- product owner
select tests.create_user('mallory') is not null;

select tests.authenticate('alice');
set local role authenticated;
select (public.create_project('DWO', 'Debt Write-Off')).id as project_id \gset
select (public.create_project('OTH', 'Other project')).id as other_project \gset
select public.add_project_member(:'project_id', 'bob@example.com', 'business_analyst');
select public.add_project_member(:'project_id', 'carol@example.com', 'developer');
select public.add_project_member(:'project_id', 'erin@example.com', 'product_owner');
reset role;

-- A process with two activities and a finding.
select tests.authenticate('bob');
set local role authenticated;
select r ->> 'process_id' as process_id, r ->> 'version_id' as v1
  from public.create_process(:'project_id', 'Debt write-off', 'to_be') r \gset
select gen_random_uuid() as n_start, gen_random_uuid() as n_submit, gen_random_uuid() as n_review, gen_random_uuid() as n_end,
       gen_random_uuid() as f_rule \gset
select public.save_process_draft(:'v1', 1, 'desc',
  jsonb_build_array(
    jsonb_build_object('element_key', :'n_start', 'node_type', 'start', 'label', 'Start'),
    jsonb_build_object('element_key', :'n_submit', 'node_type', 'activity', 'label', 'Submit request'),
    jsonb_build_object('element_key', :'n_review', 'node_type', 'approval', 'label', 'Review request'),
    jsonb_build_object('element_key', :'n_end', 'node_type', 'end', 'label', 'End')),
  jsonb_build_array(
    jsonb_build_object('element_key', gen_random_uuid(), 'source_key', :'n_start', 'target_key', :'n_submit'),
    jsonb_build_object('element_key', gen_random_uuid(), 'source_key', :'n_submit', 'target_key', :'n_review'),
    jsonb_build_object('element_key', gen_random_uuid(), 'source_key', :'n_review', 'target_key', :'n_end', 'branch', 'yes'),
    jsonb_build_object('element_key', gen_random_uuid(), 'source_key', :'n_review', 'target_key', :'n_submit', 'branch', 'no')),
  jsonb_build_array(jsonb_build_object('element_key', :'f_rule', 'kind', 'business_rule', 'origin', 'stated', 'status', 'accepted',
    'statement', 'A debt must be outstanding for more than five years to be written off.',
    'related_node_keys', jsonb_build_array(:'n_submit')))
) as rev \gset

-- ---------------------------------------------------------------------------
-- Data dictionary
-- ---------------------------------------------------------------------------
insert into public.field_definitions (project_id, name, data_type, source, origin)
values (:'project_id', 'Debt ID', 'reference', 'user_entered', 'manual') returning id as f_debt \gset
insert into public.field_definitions (project_id, name, data_type, source, source_detail)
values (:'project_id', 'Outstanding Amount', 'currency', 'retrieved', 'Debt record') returning id as f_amount \gset
select tests.ok((select string_agg(ref_code, ',' order by ref_code) from public.field_definitions) = 'FLD-001,FLD-002',
  'fields get sequential ref codes');
select tests.ok((select status = 'draft' and revision = 1 from public.field_definitions where id = :'f_debt'), 'fields start as drafts');

update public.field_definitions set status = 'approved', description = 'Debt record identifier' where id = :'f_debt' and revision = 1;
select tests.ok((select revision from public.field_definitions where id = :'f_debt') = 2, 'updates bump the revision');
update public.field_definitions set description = 'stale write' where id = :'f_debt' and revision = 1;
select tests.ok((select description from public.field_definitions where id = :'f_debt') = 'Debt record identifier',
  'an update with a stale revision changes nothing');
select tests.throws(format($$update public.field_definitions set ref_code = 'FLD-999' where id = %L$$, :'f_debt'),
  '42501', 'ref codes cannot be changed by clients');

-- Physical columns, mapped many-to-many.
insert into public.physical_columns (project_id, system_name, table_name, column_name, data_type)
values (:'project_id', 'Debt Management DB', 'debts', 'debt_id', 'uuid') returning id as c_debt \gset
insert into public.physical_columns (project_id, system_name, table_name, column_name, data_type)
values (:'project_id', 'Debt Management DB', 'debts', 'principal_cents', 'bigint') returning id as c_principal \gset
insert into public.physical_columns (project_id, system_name, table_name, column_name, data_type)
values (:'project_id', 'Debt Management DB', 'debts', 'interest_cents', 'bigint') returning id as c_interest \gset
insert into public.field_column_mappings (field_id, column_id, project_id) values (:'f_debt', :'c_debt', :'project_id');
insert into public.field_column_mappings (field_id, column_id, project_id, transformation)
values (:'f_amount', :'c_principal', :'project_id', 'principal + interest, in dollars'),
       (:'f_amount', :'c_interest', :'project_id', 'principal + interest, in dollars');
select tests.ok((select count(*) from public.field_column_mappings where field_id = :'f_amount') = 2,
  'one business field can map to several physical columns');
reset role;

-- Cross-project links are rejected (Alice is admin of both projects).
select tests.authenticate('alice');
set local role authenticated;
insert into public.field_definitions (project_id, name) values (:'other_project', 'Foreign field') returning id as f_foreign \gset
select tests.throws(format($$insert into public.field_column_mappings (field_id, column_id, project_id) values (%L, %L, %L)$$,
  :'f_foreign', :'c_debt', :'project_id'), 'PF422', 'mappings cannot link records of different projects');
select tests.throws(format($$insert into public.validation_rules (project_id, field_id, rule_type, statement) values (%L, %L, 'required', 'x')$$,
  :'project_id', :'f_foreign'), 'PF422', 'rules cannot point at another project''s field');
reset role;

-- ---------------------------------------------------------------------------
-- Validation and business rules
-- ---------------------------------------------------------------------------
select tests.authenticate('bob');
set local role authenticated;
insert into public.validation_rules (project_id, field_id, rule_type, params, statement, error_message, source_text, origin)
values (:'project_id', :'f_amount', 'range', '{"min": 0, "exclusive": true}', 'Outstanding amount must be greater than zero.',
        'Enter an amount greater than zero.', 'Outstanding amount must be greater than zero.', 'inferred')
returning id as vr1 \gset
select tests.ok((select ref_code = 'VR-001' and status = 'draft' from public.validation_rules where id = :'vr1'), 'rules start as drafts with a ref code');
update public.validation_rules set status = 'confirmed' where id = :'vr1';
select tests.ok((select status from public.validation_rules where id = :'vr1') = 'confirmed', 'analysts confirm rules');

insert into public.business_rules (project_id, title, statement, category)
values (:'project_id', 'Director approval above $10,000', 'Requests over $10,000 need Director approval.', 'approval')
returning id as br1 \gset
select tests.ok((select ref_code from public.business_rules where id = :'br1') = 'BR-001', 'business rules get ref codes');
select tests.throws(format($$insert into public.business_rules (project_id, title, statement, status) values (%L, 't', 's', 'approved')$$, :'project_id'),
  'PF422', 'business rules cannot be created already approved');
select tests.throws(format($$update public.business_rules set status = 'approved' where id = %L$$, :'br1'),
  '42501', 'analysts cannot approve business rules');
update public.validation_rules set business_rule_id = :'br1' where id = :'vr1';

-- Promote the Phase 1 finding into the register, with its activity link.
select public.promote_finding_to_business_rule(:'v1', :'f_rule', 'Five-year eligibility', 'eligibility') as br2 \gset
select tests.ok((select ref_code = 'BR-002' and source_version_id = :'v1' and origin = 'stated' from public.business_rules where id = :'br2'),
  'a finding is promoted with its origin and source');
select tests.ok((select node_key = :'n_submit'::uuid from public.business_rule_activities where business_rule_id = :'br2'),
  'the promoted rule keeps the finding''s activity links');
select tests.throws(format($$select public.promote_finding_to_business_rule(%L, %L, 'again', 'other')$$, :'v1', :'f_rule'),
  'PF409', 'a finding is promoted only once');
reset role;

select tests.authenticate('erin');
set local role authenticated;
update public.business_rules set status = 'approved' where id = :'br1';
select tests.ok((select status = 'approved' and approved_by = tests.uid('erin') from public.business_rules where id = :'br1'),
  'a product owner approves a business rule');
select tests.throws(format($$update public.business_rules set statement = 'Changed' where id = %L$$, :'br1'),
  'PF423', 'an approved rule cannot be reworded in place');
update public.business_rules set status = 'draft', statement = 'Requests of $10,000 or more need Director approval.' where id = :'br1';
select tests.ok((select status = 'draft' and approved_at is null from public.business_rules where id = :'br1'),
  'returning a rule to draft clears its approval');
update public.business_rules set status = 'approved' where id = :'br1';
delete from public.field_definitions where id = :'f_amount';
update public.field_definitions set name = 'Renamed by PO' where id = :'f_amount';
select tests.ok((select name from public.field_definitions where id = :'f_amount') = 'Outstanding Amount',
  'product owners cannot edit or delete dictionary fields');
reset role;

select tests.authenticate('alice');
set local role authenticated;
select tests.throws(format($$delete from public.business_rules where id = %L$$, :'br1'), 'PF423', 'approved business rules cannot be deleted');
reset role;

-- ---------------------------------------------------------------------------
-- Activity inputs and outputs
-- ---------------------------------------------------------------------------
select tests.authenticate('bob');
set local role authenticated;
select gen_random_uuid() as af1, gen_random_uuid() as af2, gen_random_uuid() as ao1 \gset
select public.save_version_data(:'v1', 1,
  jsonb_build_array(
    jsonb_build_object('element_key', :'af1', 'node_key', :'n_submit', 'field_id', :'f_debt', 'direction', 'input', 'mandatory', 'yes'),
    jsonb_build_object('element_key', :'af2', 'node_key', :'n_submit', 'field_id', :'f_amount', 'direction', 'input',
      'mandatory', 'conditional', 'mandatory_condition', 'When the debt is not yet loaded')),
  jsonb_build_array(jsonb_build_object('element_key', :'ao1', 'node_key', :'n_review', 'kind', 'status_change',
    'target', 'Request status: Approved'))
) as data_rev \gset
select tests.ok(:data_rev = 2, 'saving inputs and outputs returns the new data revision');
select tests.ok((select count(*) from public.activity_fields where version_id = :'v1') = 2, 'activity fields are saved');
select tests.ok((select revision from public.process_versions where id = :'v1') = :rev,
  'saving data does not change the map revision');
select tests.throws(format($$select public.save_version_data(%L, 1, '[]', '[]')$$, :'v1'), 'PF409', 'stale data saves are rejected');
select tests.throws(format($$select public.save_version_data(%L, 2, %L, '[]')$$, :'v1',
  jsonb_build_array(jsonb_build_object('element_key', gen_random_uuid(), 'node_key', :'n_start', 'field_id', :'f_debt', 'direction', 'input'))),
  'PF422', 'start and end events have no inputs');
select tests.throws(format($$select public.save_version_data(%L, 2, %L, '[]')$$, :'v1',
  jsonb_build_array(jsonb_build_object('element_key', gen_random_uuid(), 'node_key', :'n_submit', 'field_id', :'f_foreign', 'direction', 'input'))),
  'PF422', 'fields must come from the project''s dictionary');
select tests.throws(format($$select public.save_version_data(%L, 2, %L, '[]')$$, :'v1',
  jsonb_build_array(
    jsonb_build_object('element_key', gen_random_uuid(), 'node_key', :'n_submit', 'field_id', :'f_debt', 'direction', 'input'),
    jsonb_build_object('element_key', gen_random_uuid(), 'node_key', :'n_submit', 'field_id', :'f_debt', 'direction', 'input'))),
  '23505', 'a field is used once per activity and direction');
select tests.throws(format($$delete from public.field_definitions where id = %L$$, :'f_debt'), 'PF423', 'fields in use cannot be deleted');
reset role;

select tests.authenticate('carol');
set local role authenticated;
select tests.ok((select count(*) from public.activity_fields) = 2 and (select count(*) from public.field_definitions) = 2,
  'developers can read data requirements');
select tests.throws(format($$select public.save_version_data(%L, 2, '[]', '[]')$$, :'v1'), '42501', 'developers cannot save data requirements');
select tests.throws(format($$insert into public.field_definitions (project_id, name) values (%L, 'Sneaky')$$, :'project_id'),
  '42501', 'developers cannot add dictionary fields');
reset role;

select tests.authenticate('mallory');
set local role authenticated;
select tests.ok((select count(*) from public.field_definitions) + (select count(*) from public.business_rules)
  + (select count(*) from public.activity_fields) = 0, 'outsiders see no data requirements');
reset role;

-- Removing an activity from the map removes its inputs and outputs.
select tests.authenticate('bob');
set local role authenticated;
select public.save_process_draft(:'v1', :rev, 'desc',
  (select jsonb_agg(jsonb_build_object('element_key', element_key, 'node_type', node_type, 'label', label))
     from public.process_nodes where version_id = :'v1' and element_key <> :'n_review'),
  (select jsonb_agg(jsonb_build_object('element_key', element_key, 'source_key', source_key, 'target_key', target_key))
     from public.process_edges where version_id = :'v1' and :'n_review' not in (source_key, target_key)),
  '[]') as rev \gset
select tests.ok((select count(*) from public.activity_outputs where version_id = :'v1') = 0,
  'outputs of a removed activity are removed with it');
select tests.ok((select count(*) from public.activity_fields where version_id = :'v1') = 2, 'other activities keep their fields');
reset role;

-- Approval freezes the data requirements; a new draft carries them forward.
select tests.authenticate('bob');
set local role authenticated;
select public.save_process_draft(:'v1', :rev, 'desc',
  (select jsonb_agg(jsonb_build_object('element_key', element_key, 'node_type', node_type, 'label', label))
     from public.process_nodes where version_id = :'v1'),
  (select jsonb_agg(jsonb_build_object('element_key', element_key, 'source_key', source_key, 'target_key', target_key)) from (
     select element_key, source_key, target_key from public.process_edges where version_id = :'v1'
     union all select gen_random_uuid(), :'n_submit'::uuid, :'n_end'::uuid) e),
  '[]') as rev \gset
reset role;
select tests.authenticate('erin');
set local role authenticated;
select public.approve_process_version(:'v1', :rev);
reset role;
select tests.authenticate('bob');
set local role authenticated;
select tests.throws(format($$select public.save_version_data(%L, 3, '[]', '[]')$$, :'v1'), 'PF423',
  'data requirements of an approved version are frozen');
select public.create_draft_from_version(:'v1') as v2 \gset
select tests.ok((select count(*) from public.activity_fields where version_id = :'v2') = 2
  and (select array_agg(element_key order by element_key) from public.activity_fields where version_id = :'v2')
    = (select array_agg(element_key order by element_key) from public.activity_fields where version_id = :'v1'),
  'a new draft carries the data requirements with the same element keys');
select tests.ok((select data_revision from public.process_versions where id = :'v2') = 1, 'the new draft starts at data revision 1');
reset role;
select tests.throws(format($$delete from public.activity_fields where version_id = %L$$, :'v1'), 'PF423',
  'triggers protect approved data requirements even from privileged roles');

rollback;
