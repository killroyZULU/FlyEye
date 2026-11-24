import assert from 'node:assert/strict';

export function proveForeignDeclarationDenied(sql, school, actor, session, action) {
  assert.ok(['declare_elp', 'declare_ntc'].includes(action));
  // Known eligible targets distinguish a real owner/school denial from a missing row.
  sql(`begin;
    set constraints organizations_single_school_deployment_key deferred;
    do $proof$
    declare second_school uuid:=gen_random_uuid(); org uuid; foreign_user uuid; foreign_member uuid; reply jsonb;
    begin
      insert into public.organizations(id,name) values(second_school,'Synthetic second school');
      foreach org in array array['${school}'::uuid,second_school] loop
        foreign_user:=gen_random_uuid(); foreign_member:=gen_random_uuid();
        insert into auth.users(id) values(foreign_user);
        insert into public.organization_memberships(id,organization_id,user_id) values(foreign_member,org,foreign_user);
        insert into public.membership_roles(organization_id,membership_id,role_id)
          select org,foreign_member,id from public.roles where code='student_pilot' and is_active;
        if not found then raise exception 'missing fixture role'; end if;
        update public.organization_member_profiles set credential_applicability='trainee' where membership_id=foreign_member and organization_id=org;
        if not found then raise exception 'missing fixture profile'; end if;
        reply:=public.credential_owner_submission('${actor}','${session}',true,org,extract(epoch from now())::bigint+60,
          foreign_member,'${action}',null,jsonb_build_object('operationId',gen_random_uuid()));
        if reply is not null or exists(select from credential_private.declarations where membership_id=foreign_member)
          then raise exception 'foreign declaration'; end if;
      end loop;
    end; $proof$; rollback;`);
}
