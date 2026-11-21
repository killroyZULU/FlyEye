begin;

-- The existing unique school/member profile also owns credential applicability.
-- Existing and newly enrolled members start unclassified until an Admin sets it.
alter table public.organization_member_profiles add column credential_applicability text
  check (credential_applicability in ('trainee','instructor','both'));

insert into public.permissions (code, description) values
  ('credential.own.read', 'View personal credential requirements.'),
  ('credential.school.read', 'View personnel credential requirements in this school.'),
  ('credential.applicability.manage', 'Set credential applicability in this school.');

insert into public.roles (code, display_name, is_membership_assignable, required_assurance_level, workspace_permission_code)
values ('head_of_training', 'Head of Training', true, 'aal2', 'portal.instructor.access'),
       ('chief_flight_instructor', 'Chief Flight Instructor', true, 'aal2', 'portal.instructor.access');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where (p.code = 'credential.own.read' and r.code in ('admin','student_pilot','instructor_pilot'))
   or (p.code in ('credential.school.read','credential.applicability.manage') and r.code = 'admin');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code in ('head_of_training','chief_flight_instructor')
and (p.code = 'credential.school.read' or p.id in (
  select rp.permission_id from public.role_permissions rp join public.roles instructor on instructor.id = rp.role_id
  where instructor.code = 'instructor_pilot'));

-- Only the definer below can call this helper. Recheck after any audit/row wait.
create function public.credential_session_is_current(p_actor uuid,p_session uuid,p_factor uuid,p_privileged boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from auth.sessions s where s.id=p_session and s.user_id=p_actor
    and (s.not_after is null or s.not_after>clock_timestamp())
    and exists (select 1 from auth.mfa_amr_claims a where a.session_id=s.id and a.authentication_method='password'))
    then return false; end if;
  if not p_privileged then return true; end if;
  return p_factor is not null and public.validate_admin_session_factor(p_actor,p_session,p_factor,true);
end;
$$;
revoke all on function public.credential_session_is_current(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;

-- Service-only entrypoint. The Edge supplies the verified actor, session and token assurance.
create function public.credential_workspace(
  p_actor uuid, p_session uuid, p_totp boolean, p_school uuid, p_action text,
  p_member uuid, p_after uuid, p_applicability text, p_version bigint, p_correlation uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_member uuid;
  assurance text;
  required_permission text;
  session_factor uuid;
  privileged boolean;
  row_profile public.organization_member_profiles%rowtype;
  rows jsonb;
  more boolean := false;
  denied jsonb := jsonb_build_object('decision','not_found','correlationId',p_correlation);
begin
  required_permission := case p_action
    when 'my_credentials' then 'credential.own.read'
    when 'personnel_credentials' then 'credential.school.read'
    when 'set_credential_applicability' then 'credential.applicability.manage' end;
  if required_permission is null or p_correlation is null then return denied; end if;

  select m.id, r.required_assurance_level into actor_member, assurance
  from public.organizations o
  join public.organization_memberships m on m.organization_id=o.id
  join public.membership_roles mr on (mr.organization_id,mr.membership_id)=(o.id,m.id)
  join public.roles r on r.id=mr.role_id
  join public.role_permissions rp on rp.role_id=r.id
  join public.permissions perm on perm.id=rp.permission_id
  join public.permissions portal on portal.code=r.workspace_permission_code
  join public.role_permissions rp_portal on (rp_portal.role_id,rp_portal.permission_id)=(r.id,portal.id)
  where o.id=p_school and o.status='active' and m.status='active' and m.user_id=p_actor
    and r.is_active and perm.code=required_permission
  for share of o,m,mr,r,rp,perm,portal,rp_portal;
  if not found or (p_action='my_credentials' and actor_member is distinct from p_member) then
    return denied;
  end if;

  privileged := assurance='aal2' or p_action<>'my_credentials';
  select factor_id into session_factor from auth.sessions where id=p_session and user_id=p_actor;
  if (privileged and p_totp is not true) or not public.credential_session_is_current(p_actor,p_session,session_factor,privileged)
    then return denied; end if;

  if p_action='personnel_credentials' then
    perform public.write_member_administration_event(p_school,p_actor,null,'member_directory.listed',
      'success','credential_personnel_listed',p_correlation);
    with page as (
      select m.id, f.display_name, f.credential_applicability, f.version
      from public.organization_memberships m join public.organization_member_profiles f
        on (f.organization_id,f.membership_id)=(m.organization_id,m.id)
      where m.organization_id=p_school and m.status='active' and (p_after is null or m.id>p_after)
      order by m.id limit 51
    ), shown as (select * from page order by id limit 50)
    select coalesce(jsonb_agg(jsonb_build_object('membershipId',id,'displayName',display_name,
      'applicability',credential_applicability,'version',version) order by id),'[]'::jsonb),
      (select count(*)>50 from page) into rows, more from shown;
  else
    select f.* into row_profile from public.organization_member_profiles f
    join public.organization_memberships m on (m.organization_id,m.id)=(f.organization_id,f.membership_id)
    where f.organization_id=p_school and f.membership_id=p_member and m.status='active'
    for update of f for share of m;
    if not found then return denied; end if;
    if p_action='set_credential_applicability' then
      if p_applicability is null or p_applicability not in ('trainee','instructor','both') then return denied; end if;
      if p_version is distinct from row_profile.version then
        return jsonb_build_object('decision','state_conflict','correlationId',p_correlation);
      end if;
      if row_profile.credential_applicability is distinct from p_applicability then
        perform public.write_member_administration_event(p_school,p_actor,p_member,'member_profile.updated',
          'success','credential_applicability_changed',p_correlation,null,
          jsonb_build_object('previous',row_profile.credential_applicability,'current',p_applicability));
        update public.organization_member_profiles set credential_applicability=p_applicability,
          version=version+1,updated_at=now(),updated_by=p_actor where id=row_profile.id returning * into row_profile;
      end if;
    else
      perform public.write_member_administration_event(p_school,p_actor,p_member,'member_profile.viewed',
        'success','credential_requirements_viewed',p_correlation);
    end if;
    rows := jsonb_build_array(jsonb_build_object('membershipId',p_member,'displayName',row_profile.display_name,
      'applicability',row_profile.credential_applicability,'version',row_profile.version));
  end if;
  if not public.credential_session_is_current(p_actor,p_session,session_factor,privileged) then
    raise exception using errcode='P9009',message='Credential session changed';
  end if;
  return jsonb_build_object('decision','credential_workspace','organizationId',p_school,'members',rows,
    'hasMore',more,'correlationId',p_correlation);
exception when sqlstate 'P9009' then
  return denied;
end;
$$;

revoke all on function public.credential_workspace(uuid,uuid,boolean,uuid,text,uuid,uuid,text,bigint,uuid)
  from public,anon,authenticated;
grant execute on function public.credential_workspace(uuid,uuid,boolean,uuid,text,uuid,uuid,text,bigint,uuid) to service_role;

commit;
