import { passwordAuthenticationIsRecent } from '../_shared/authentication-evidence.ts';
import {
  aircraftDocumentRequestSchema,
  type AircraftDocumentAction,
  type AircraftDocumentRequest,
} from './domain.ts';
import { processFile } from './file-actions.ts';
import { processMutation } from './mutation-actions.ts';
import {
  checkedResponse,
  consumeGeneral,
  limited,
  securityFailure,
  type AircraftDocumentDependencies,
  type ProcessingContext,
} from './processing.ts';
import {
  aircraftListSchema,
  contextSchema,
  detailSchema,
  historySchema,
  notificationListSchema,
  notificationOpenSchema,
  statusListSchema,
} from './response-schemas.ts';
import { caughtFailureCode, failure, json, readBody, responseHeaders } from './transport.ts';

export type { AircraftDocumentDependencies } from './processing.ts';

function currentPhilippineDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function permissionFor(
  action: AircraftDocumentAction,
  access: typeof contextSchema._output,
): boolean {
  if (action === 'aircraft_list' || action === 'status_list') return access.canReadStatus;
  if (action === 'detail' || action === 'history') return access.canRead;
  if (action === 'notifications_list' || action === 'notification_open') {
    return access.canReadNotifications;
  }
  if (action.startsWith('category_')) return access.canManageCategories;
  if (action === 'attachment_download') return access.canReadAttachment;
  return access.canManage;
}

function assuranceAllows(context: ProcessingContext): boolean {
  if (
    (context.requestData.action === 'aircraft_list' ||
      context.requestData.action === 'status_list') &&
    context.access.roleCode === 'student_pilot'
  ) {
    return true;
  }
  return context.actor.assuranceLevel === 'aal2' && context.actor.totpAuthenticatedAt !== null;
}

async function parseRequest(origin: string, request: Request) {
  if (request.headers.get('origin') !== origin) {
    return failure(origin, 'unauthorized', crypto.randomUUID());
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return json(origin, 405, { error: { code: 'aircraft_documents.method_not_allowed' } });
  }
  const match = /^Bearer\s+([^\s]+)$/iu.exec(request.headers.get('authorization') ?? '');
  if (!match?.[1]) return failure(origin, 'unauthenticated', crypto.randomUUID());
  try {
    const parsed = aircraftDocumentRequestSchema.safeParse(JSON.parse(await readBody(request)));
    return parsed.success
      ? { accessToken: match[1], requestData: parsed.data }
      : failure(origin, 'validation_failed', crypto.randomUUID());
  } catch {
    return failure(origin, 'validation_failed', crypto.randomUUID());
  }
}

async function prepareContext(
  dependencies: AircraftDocumentDependencies,
  parsed: { accessToken: string; requestData: AircraftDocumentRequest },
  correlationId: string,
  philippineDate: string,
): Promise<Response | ProcessingContext> {
  let actor;
  try {
    actor = await dependencies.authenticate(parsed.accessToken);
  } catch {
    return failure(dependencies.allowedOrigin, 'unauthenticated', correlationId);
  }
  const access = contextSchema.safeParse(
    await dependencies.resolveContext(actor.actorUserId).catch(() => null),
  );
  if (!access.success) {
    return failure(dependencies.allowedOrigin, 'service_unavailable', correlationId);
  }
  const limiterKeyHash = await dependencies
    .limiterKey(actor.actorSubjectId, access.data.organizationId)
    .catch(() => null);
  if (!limiterKeyHash) {
    return failure(dependencies.allowedOrigin, 'service_unavailable', correlationId);
  }
  const context: ProcessingContext = {
    origin: dependencies.allowedOrigin,
    actor,
    access: access.data,
    requestData: parsed.requestData,
    correlationId,
    limiterKeyHash,
    philippineDate,
  };
  const general = await consumeGeneral(dependencies, context);
  if (!general) return failure(context.origin, 'service_unavailable', correlationId);
  if (!general.allowed) {
    return failure(
      context.origin,
      'rate_limited',
      correlationId,
      general.retryAfterSeconds ?? undefined,
    );
  }
  if (!permissionFor(parsed.requestData.action, access.data)) {
    return securityFailure(dependencies, context, 'unauthorized');
  }
  if (!assuranceAllows(context)) return securityFailure(dependencies, context, 'mfa_required');
  if (
    (parsed.requestData.action.startsWith('category_') ||
      parsed.requestData.action === 'attachment_download') &&
    !passwordAuthenticationIsRecent(actor)
  ) {
    return securityFailure(dependencies, context, 'recent_password_required');
  }
  return context;
}

async function processRead(dependencies: AircraftDocumentDependencies, context: ProcessingContext) {
  const denied = await limited(dependencies, context, 'read');
  if (denied) return denied;
  const common = {
    p_actor_user_id: context.actor.actorUserId,
    p_organization_id: context.access.organizationId,
    p_correlation_id: context.correlationId,
  };
  const request = context.requestData;
  try {
    if (request.action === 'aircraft_list') {
      return checkedResponse(
        dependencies,
        context,
        await dependencies.rpc('list_aircraft_for_document_status', {
          ...common,
          p_page: request.page,
          p_page_size: request.pageSize,
        }),
        aircraftListSchema,
      );
    }
    if (request.action === 'status_list') {
      return checkedResponse(
        dependencies,
        context,
        await dependencies.rpc('list_aircraft_document_status', {
          ...common,
          p_aircraft_record_id: request.aircraftId,
          p_philippine_date: context.philippineDate,
        }),
        statusListSchema,
      );
    }
    if (request.action === 'detail') {
      return checkedResponse(
        dependencies,
        context,
        await dependencies.rpc('get_aircraft_document_detail', {
          ...common,
          p_document_id: request.documentId,
          p_philippine_date: context.philippineDate,
        }),
        detailSchema,
      );
    }
    if (request.action === 'history') {
      return checkedResponse(
        dependencies,
        context,
        await dependencies.rpc('list_aircraft_document_history', {
          ...common,
          p_document_id: request.documentId,
          p_page: request.page,
          p_page_size: request.pageSize,
        }),
        historySchema,
      );
    }
    if (request.action === 'notifications_list') {
      return checkedResponse(
        dependencies,
        context,
        await dependencies.rpc('list_aircraft_document_notifications', {
          ...common,
          p_membership_id: context.access.membershipId,
          p_page: request.page,
          p_page_size: request.pageSize,
          p_include_resolved: request.includeResolved,
        }),
        notificationListSchema,
      );
    }
    return checkedResponse(
      dependencies,
      context,
      await dependencies.rpc('open_aircraft_document_notification', {
        ...common,
        p_membership_id: context.access.membershipId,
        p_notification_id: (
          request as Extract<AircraftDocumentRequest, { action: 'notification_open' }>
        ).notificationId,
      }),
      notificationOpenSchema,
    );
  } catch (error) {
    return failure(
      context.origin,
      caughtFailureCode(error, 'service_unavailable'),
      context.correlationId,
    );
  }
}

export function createAircraftDocumentHandler(dependencies: AircraftDocumentDependencies) {
  const createCorrelationId = dependencies.createCorrelationId ?? (() => crypto.randomUUID());
  const date = dependencies.currentPhilippineDate ?? currentPhilippineDate;
  return async (request: Request): Promise<Response> => {
    const parsed = await parseRequest(dependencies.allowedOrigin, request);
    if (parsed instanceof Response) return parsed;
    const context = await prepareContext(dependencies, parsed, createCorrelationId(), date());
    if (context instanceof Response) return context;
    if (
      [
        'aircraft_list',
        'status_list',
        'detail',
        'history',
        'notifications_list',
        'notification_open',
      ].includes(context.requestData.action)
    ) {
      return processRead(dependencies, context);
    }
    if (
      ['file_initiate', 'file_complete', 'attachment_download'].includes(context.requestData.action)
    ) {
      return processFile(dependencies, context);
    }
    return processMutation(dependencies, context);
  };
}
