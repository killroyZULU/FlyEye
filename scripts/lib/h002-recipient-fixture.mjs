import { q, scope, snapshot as acceptanceSnapshot } from './h002-acceptance-fixture.mjs';

export const spareUser = "'e2700000-0000-4000-8000-000000000001'";
export const spareMember = "'e2700000-0000-4000-8000-000000000002'";
export const email = 'h002-accept-recipient@example.test';
export const changedEmail = 'h002-changed-recipient@example.test';
export const identityLock = `select 1 from auth.users where id=${q('recipient')} for update;`;
export const changes = {
  email: `update auth.users set email='${changedEmail}' where id=${q('recipient')};`,
  confirmation: `update auth.users set email_confirmed_at=null where id=${q('recipient')};`,
};
export const resetIdentity = `update auth.users set email='${email}',email_confirmed_at=now()
  where id=${q('recipient')};
  update public.organization_invitations set provider_operation_class='existing_identity_sign_in',
    delivery_operation_id=${q('correlation')},delivery_outcome='accepted',delivery_attempt_count=1,
    last_delivery_attempt_at=now()
  where id=${q('invitation')};`;
export const prepare = `select public.prepare_member_invitation_acceptance(
  ${q('recipient')},'${email}',${q('invitation')},1,${q('correlation')});`;
export const insertMember = (user) => `insert into public.organization_memberships
  (id,organization_id,user_id,status,created_by,updated_by)
  values(${spareMember},${q('org')},${user},'suspended',${q('admin')},${q('admin')});`;
export const reassignMember = `update public.organization_memberships
  set user_id=${q('recipient')} where id=${spareMember};`;
export const snapshot = `select state || jsonb_build_object(
  'identity',(select jsonb_build_object('id',id,'email',email,'confirmed',email_confirmed_at)
    from auth.users where id=${q('recipient')}),
  'profiles',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb)
    from public.organization_member_profiles p where ${scope} and membership_id<>${q('adminMember')}),
  'peerMember',(select to_jsonb(m) from public.organization_memberships m where id=${spareMember})
) from (${acceptanceSnapshot.trim().replace(/;$/, '')}) s(state);`;

export const auditProbe = `
  create function public.h002_recipient_audit_probe() returns trigger
  language plpgsql set search_path=pg_catalog,public as $$
  begin
    if new.actor_user_id=${q('recipient')}
       and new.event_name=current_setting('flyeye.recipient_reject_event',true) then
      raise exception using errcode='23514',message='Synthetic recipient audit failure';
    end if;
    return new;
  end; $$;
  create trigger h002_recipient_audit_probe before insert on public.member_invitation_events
  for each row execute function public.h002_recipient_audit_probe();`;
export const dropProbe = `drop trigger if exists h002_recipient_audit_probe on public.member_invitation_events;
  drop function if exists public.h002_recipient_audit_probe();`;
export const cleanCase = `select
  (select count(*) from public.organization_memberships where ${scope} and id<>${q('adminMember')})
  +(select count(*) from public.organization_member_profiles where ${scope} and membership_id<>${q('adminMember')})
  +(select count(*) from public.membership_roles where ${scope} and membership_id<>${q('adminMember')})
  +(select count(*) from public.member_invitation_events where ${scope} or actor_user_id=${q('recipient')});`;
