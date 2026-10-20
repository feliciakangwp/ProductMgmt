-- Projects, membership and row level security.
begin;

select tests.create_user('alice') is not null;   -- creates the project, admin
select tests.create_user('bob') is not null;     -- business analyst
select tests.create_user('carol') is not null;   -- developer
select tests.create_user('erin') is not null;    -- product owner
select tests.create_user('mallory') is not null; -- not a member

select tests.ok((select display_name from public.profiles where id = tests.uid('alice')) = 'Alice',
  'a profile is created for each new auth user');

insert into auth.users (email, raw_user_meta_data) values (null, jsonb_build_object('display_name', repeat('x', 300)));
insert into auth.users (email) values (null);
select tests.ok((select count(*) from public.profiles where email = '') = 2 and (select max(char_length(display_name)) from public.profiles) = 120,
  'users without email and with long names can sign up');

-- Anonymous users cannot read anything.
set local role anon;
select tests.throws('select * from public.projects', '42501', 'anon cannot read projects');
reset role;

-- Alice creates a project and becomes its administrator.
select tests.authenticate('alice');
set local role authenticated;
select (public.create_project('dwo', 'Debt Write-Off', 'Finance write-off process')).id as project_id \gset
select tests.ok((select key from public.projects where id = :'project_id') = 'DWO', 'project key is normalised to upper case');
select tests.ok((select role from public.project_members where project_id = :'project_id' and user_id = tests.uid('alice')) = 'admin',
  'the creator becomes project admin');
select tests.throws($$select public.create_project('DWO', 'Duplicate')$$, 'PF409', 'project keys are unique');
select tests.throws($$select public.create_project('1BAD', 'Bad key')$$, '23514', 'project keys must match the key format');

select public.add_project_member(:'project_id', 'bob@example.com', 'business_analyst');
select public.add_project_member(:'project_id', 'CAROL@example.com', 'developer');
select public.add_project_member(:'project_id', 'erin@example.com', 'product_owner');
select tests.ok((select count(*) from public.project_members where project_id = :'project_id') = 4, 'admin can add members by email');
select tests.throws(format($$select public.add_project_member(%L, 'nobody@example.com', 'developer')$$, :'project_id'),
  'P0002', 'adding an unknown email fails clearly');
select tests.throws(format($$select public.add_project_member(%L, 'bob@example.com', 'developer')$$, :'project_id'),
  'PF409', 'adding an existing member fails');
select tests.throws(format($$select public.update_member_role(%L, %L, 'developer')$$, :'project_id', tests.uid('alice')),
  'PF422', 'the last admin cannot be demoted');
select tests.throws(format($$select public.remove_project_member(%L, %L)$$, :'project_id', tests.uid('alice')),
  'PF422', 'the last admin cannot be removed');
select tests.ok((select count(*) from public.audit_log where project_id = :'project_id' and table_name = 'project_members') = 4,
  'membership changes are audited');
reset role;

-- Bob (BA) can read the project but cannot manage members or rename it.
select tests.authenticate('bob');
set local role authenticated;
select tests.ok((select count(*) from public.projects) = 1, 'members can see their project');
select tests.ok((select count(*) from public.profiles) = 4, 'members can see profiles of fellow members only');
select tests.throws(format($$select public.add_project_member(%L, 'mallory@example.com', 'admin')$$, :'project_id'),
  '42501', 'non-admins cannot add members');
update public.projects set name = 'Hijacked' where id = :'project_id';
select tests.ok((select name from public.projects where id = :'project_id') = 'Debt Write-Off', 'non-admins cannot rename the project');
select tests.ok((select count(*) from public.audit_log) = 0, 'non-admin, non-PO members cannot read the audit log');
select tests.throws($$insert into public.projects (key, name, created_by) values ('XX', 'Direct', auth.uid())$$,
  '42501', 'projects cannot be inserted directly, only through create_project');
select tests.throws(format($$select public.next_ref(%L, 'PRC')$$, :'project_id'), '42501', 'internal helpers are not callable');
reset role;

-- Mallory sees nothing.
select tests.authenticate('mallory');
set local role authenticated;
select tests.ok((select count(*) from public.projects) = 0, 'outsiders cannot see the project');
select tests.ok((select count(*) from public.project_members) = 0, 'outsiders cannot see members');
select tests.ok((select count(*) from public.profiles) = 1, 'outsiders only see their own profile');
reset role;

-- Alice renames the project and promotes Erin to admin, then can step down.
select tests.authenticate('alice');
set local role authenticated;
update public.projects set name = 'Debt Write-Off Programme' where id = :'project_id';
select tests.ok((select name from public.projects where id = :'project_id') = 'Debt Write-Off Programme', 'admins can rename the project');
select public.update_member_role(:'project_id', tests.uid('erin'), 'admin');
select public.update_member_role(:'project_id', tests.uid('alice'), 'product_owner');
select tests.ok((select role from public.project_members where user_id = tests.uid('alice')) = 'product_owner',
  'an admin can step down once another admin exists');
reset role;

rollback;
