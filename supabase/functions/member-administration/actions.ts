import {
  MemberAdministrationAuditWriteError,
  type AdministrationContext,
  type MemberAdministrationRequest,
} from './contracts.ts';
import { reportAuditFailure } from './audit.ts';
import { failure } from './responses.ts';
import { listMembers, memberDetail } from './directory.ts';
import { memberProfile, changeMemberStatus } from './profile-status.ts';
import { assignMemberRole } from './role-assignment.ts';

export async function executeAdministrationAction(
  context: AdministrationContext,
  data: MemberAdministrationRequest,
): Promise<Response> {
  try {
    // Await each action so asynchronous audit failures remain inside this boundary.
    switch (data.action) {
      case 'list':
        return await listMembers(context, data);
      case 'detail':
        return await memberDetail(context, data);
      case 'get_profile':
      case 'update_profile':
        return await memberProfile(context, data);
      case 'suspend':
      case 'reactivate':
      case 'revoke':
        return await changeMemberStatus(context, data);
      case 'assign_role':
        return await assignMemberRole(context, data);
    }
  } catch (error) {
    if (error instanceof MemberAdministrationAuditWriteError)
      reportAuditFailure(context.dependencies, data.action, context.correlationId);
    return failure(context.origin, 'service_unavailable', context.correlationId);
  }
}
