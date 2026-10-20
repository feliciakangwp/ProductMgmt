-- Test helpers. Applied after the migrations.
create schema tests;
grant usage on schema tests to authenticated, anon;

create table tests.users (name text primary key, id uuid not null);
grant select on tests.users to authenticated, anon;

create function tests.create_user(p_name text) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into auth.users (email, raw_user_meta_data)
  values (p_name || '@example.com', jsonb_build_object('display_name', initcap(p_name)))
  returning id into v_id;
  insert into tests.users values (p_name, v_id);
  return v_id;
end $$;

create function tests.uid(p_name text) returns uuid
language sql stable as $$ select id from tests.users where name = p_name $$;

-- Sets the JWT claims for the current transaction. Follow with
-- `set local role authenticated;` to act as that user.
create function tests.authenticate(p_name text) returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', tests.uid(p_name), 'role', 'authenticated')::text, true);
$$;

create function tests.ok(p_condition boolean, p_message text) returns void
language plpgsql as $$
begin
  if p_condition is distinct from true then
    raise exception 'FAILED: %', p_message;
  end if;
  raise notice 'ok - %', p_message;
end $$;

-- Asserts that running p_sql raises an error with the given SQLSTATE.
create function tests.throws(p_sql text, p_sqlstate text, p_message text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate then
      raise notice 'ok - % (% %)', p_message, sqlstate, sqlerrm;
      return;
    end if;
    raise exception 'FAILED: % - expected SQLSTATE %, got % (%)', p_message, p_sqlstate, sqlstate, sqlerrm;
  end;
  raise exception 'FAILED: % - expected SQLSTATE %, but no error was raised', p_message, p_sqlstate;
end $$;

grant execute on all functions in schema tests to authenticated, anon;
