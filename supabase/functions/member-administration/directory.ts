import {
  databaseListSchema,
  detailResultSchema,
  type AdministrationContext,
  type MemberAdministrationRequest,
  type CursorBoundary,
} from './contracts.ts';
import { auditFailure, rejectedResult } from './audit.ts';
import { failure, json } from './responses.ts';

export async function listMembers(
  context: AdministrationContext,
  data: Extract<MemberAdministrationRequest, { action: 'list' }>,
): Promise<Response> {
  const { dependencies, actor, origin, correlationId } = context;

  let boundary: CursorBoundary | null = null;
  if (data.cursor) {
    try {
      boundary = await dependencies.decodeCursor(
        data.cursor,
        data.status ?? null,
        data.search ?? null,
      );
    } catch {
      if (
        !(await auditFailure(
          dependencies,
          data,
          actor.actorUserId,
          'validation_failed',
          correlationId,
        ))
      ) {
        return failure(origin, 'service_unavailable', correlationId);
      }
      return failure(origin, 'validation_failed', correlationId);
    }
  }
  const rawList = await dependencies.list({
    actorUserId: actor.actorUserId,
    organizationId: data.organizationId,
    status: data.status ?? null,
    search: data.search ?? null,
    boundary,
    correlationId,
  });
  const listed = databaseListSchema.safeParse(rawList);
  if (
    listed.success &&
    listed.data.correlationId === correlationId &&
    listed.data.organizationId === data.organizationId
  ) {
    const nextCursor = listed.data.hasMore
      ? await dependencies.encodeCursor(
          {
            createdAt: listed.data.nextCreatedAt!,
            membershipId: listed.data.nextMembershipId!,
          },
          data.status ?? null,
          data.search ?? null,
        )
      : undefined;
    return json(origin, 200, {
      decision: 'listed',
      organizationId: listed.data.organizationId,
      members: listed.data.members,
      nextCursor,
      correlationId,
    });
  }
  return await rejectedResult(context, data, rawList);
}

export async function memberDetail(
  context: AdministrationContext,
  data: Extract<MemberAdministrationRequest, { action: 'detail' }>,
): Promise<Response> {
  const { dependencies, actor, origin, correlationId } = context;

  const rawDetail = await dependencies.detail({
    actorUserId: actor.actorUserId,
    organizationId: data.organizationId,
    membershipId: data.membershipId,
    correlationId,
  });
  const detailed = detailResultSchema.safeParse(rawDetail);
  if (
    detailed.success &&
    detailed.data.correlationId === correlationId &&
    detailed.data.organizationId === data.organizationId &&
    detailed.data.member.membershipId === data.membershipId
  ) {
    return json(origin, 200, detailed.data);
  }
  return await rejectedResult(context, data, rawDetail);
}
