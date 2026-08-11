begin;

select plan(6);

select has_column(
  'public',
  'organizations',
  'deployment_slot',
  'The school record carries the fixed deployment slot'
);

select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organizations'
      and column_name = 'deployment_slot'
  ),
  'smallint',
  'The deployment slot uses a small integer'
);

select is(
  (
    select count(*)::integer
    from pg_constraint
    where conname in (
      'organizations_single_school_deployment_key',
      'organization_memberships_single_school_user_key'
    )
      and contype = 'u'
  ),
  2,
  'School and per-user membership singleton constraints exist'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'b1000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'single-school@example.test',
  crypt('Synthetic-password-006!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.organizations (id, name)
values ('b2000000-0000-4000-8000-000000000001', 'Synthetic Single School');

select throws_ok(
  $$insert into public.organizations (id, name)
    values ('b2000000-0000-4000-8000-000000000002', 'Unexpected Second School')$$,
  '23505',
  null,
  'A second school record is rejected'
);

insert into public.organization_memberships (id, organization_id, user_id)
values (
  'b3000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001'
);

select throws_ok(
  $$insert into public.organization_memberships (id, organization_id, user_id)
    values (
      'b3000000-0000-4000-8000-000000000002',
      'b2000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000001'
    )$$,
  '23505',
  null,
  'A second membership for one account is rejected'
);

select throws_ok(
  $$insert into public.authentication_events (
      organization_id, organization_ids, actor_user_id, actor_subject_id,
      event_name, outcome, correlation_id, reason_code
    ) values (
      'b2000000-0000-4000-8000-000000000001',
      array[
        'b2000000-0000-4000-8000-000000000001'::uuid,
        'b2000000-0000-4000-8000-000000000002'::uuid
      ],
      'b1000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000001',
      'authentication.access_context_loaded',
      'success',
      'b4000000-0000-4000-8000-000000000001',
      'access_context_granted'
    )$$,
  '23514',
  null,
  'Authentication audit cannot claim more than one school context'
);

select * from finish();
rollback;
