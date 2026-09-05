import {
  canonicalDocumentMutationPayload,
  normalizeCategoryLabel,
  normalizeDocumentMetadata,
  normalizeLifecycleReason,
  type AircraftDocumentAction,
  type AircraftDocumentRequest,
} from './domain.ts';
import { categoryMutationSchema, idempotencySchema, mutationSchema } from './response-schemas.ts';
import { caughtFailureCode, failure } from './transport.ts';
import {
  checkedResponse,
  limited,
  securityFailure,
  sha256,
  type AircraftDocumentDependencies,
  type DocumentLimiterBucket,
  type ProcessingContext,
} from './processing.ts';

function mutationAction(request: AircraftDocumentRequest): string {
  const mapping: Partial<Record<AircraftDocumentAction, string>> = {
    category_create: 'create_category',
    category_rename: 'rename_category',
    category_archive: 'archive_category',
    category_assign: 'assign_category',
    category_remove: 'remove_category',
  };
  return mapping[request.action] ?? request.action;
}

function normalizeMutation(request: AircraftDocumentRequest): Record<string, unknown> {
  if (request.action === 'create' || request.action === 'renew' || request.action === 'correct') {
    return {
      aircraftId: request.aircraftId,
      categoryId: request.categoryId,
      documentId: request.action === 'create' ? null : request.documentId,
      expectedVersion: request.action === 'create' ? null : request.expectedVersion,
      ...normalizeDocumentMetadata(request),
    };
  }
  if (request.action === 'suspend' || request.action === 'restore') {
    return {
      aircraftId: request.aircraftId,
      categoryId: request.categoryId,
      documentId: request.documentId,
      expectedVersion: request.expectedVersion,
      reason: normalizeLifecycleReason(request.reason),
    };
  }
  const categoryRequest = request as Extract<
    AircraftDocumentRequest,
    { action: `category_${string}` }
  >;
  return {
    categoryId: 'categoryId' in categoryRequest ? categoryRequest.categoryId : null,
    aircraftId: 'aircraftId' in categoryRequest ? categoryRequest.aircraftId : null,
    expectedVersion: 'expectedVersion' in categoryRequest ? categoryRequest.expectedVersion : null,
    categoryLabel:
      'categoryLabel' in categoryRequest
        ? normalizeCategoryLabel(categoryRequest.categoryLabel)
        : null,
  };
}

async function lookupReplay(
  dependencies: AircraftDocumentDependencies,
  context: ProcessingContext,
  input: {
    action: string;
    category: boolean;
    targetId: string | null;
    expectedVersion: number | null;
    keyHash: string;
    requestHash: string;
  },
) {
  return idempotencySchema.safeParse(
    await dependencies
      .rpc('lookup_aircraft_document_idempotency', {
        p_actor_user_id: context.actor.actorUserId,
        p_organization_id: context.access.organizationId,
        p_permission_code: input.category
          ? 'aircraft.document.category.manage'
          : 'aircraft.document.manage',
        p_action: input.action,
        p_target_id: input.targetId,
        p_expected_version: input.expectedVersion,
        p_idempotency_key_hash: input.keyHash,
        p_request_hash: input.requestHash,
      })
      .catch(() => null),
  );
}

async function invokeMutation(
  dependencies: AircraftDocumentDependencies,
  context: ProcessingContext,
  input: {
    action: string;
    category: boolean;
    normalized: Record<string, unknown>;
    keyHash: string;
    requestHash: string;
  },
) {
  const common = {
    p_actor_user_id: context.actor.actorUserId,
    p_organization_id: context.access.organizationId,
    p_action: input.action,
    p_idempotency_key_hash: input.keyHash,
    p_request_hash: input.requestHash,
    p_philippine_date: context.philippineDate,
    p_correlation_id: context.correlationId,
  };
  if (input.category) {
    return dependencies.rpc('mutate_aircraft_document_category', {
      ...common,
      p_category_id: input.normalized.categoryId,
      p_aircraft_record_id: input.normalized.aircraftId,
      p_expected_version: input.normalized.expectedVersion,
      p_category_label: input.normalized.categoryLabel,
    });
  }
  return dependencies.rpc('mutate_aircraft_document', {
    ...common,
    p_aircraft_record_id: input.normalized.aircraftId,
    p_category_id: input.normalized.categoryId,
    p_document_id: input.normalized.documentId,
    p_expected_version: input.normalized.expectedVersion,
    p_document_title: input.normalized.documentTitle ?? null,
    p_document_source: input.normalized.documentSource ?? null,
    p_reference_number: input.normalized.referenceNumber ?? null,
    p_issue_date: input.normalized.issueDate ?? null,
    p_expiration_date: input.normalized.expirationDate ?? null,
    p_notes: input.normalized.notes ?? null,
    p_stored_file_id: input.normalized.storedFileId ?? null,
    p_reason: input.normalized.reason ?? null,
  });
}

export async function processMutation(
  dependencies: AircraftDocumentDependencies,
  context: ProcessingContext,
) {
  const request = context.requestData;
  const category = request.action.startsWith('category_');
  const bucket: DocumentLimiterBucket =
    category || request.action === 'suspend' || request.action === 'restore'
      ? 'lifecycle'
      : 'mutation';
  let normalized: Record<string, unknown>;
  try {
    normalized = normalizeMutation(request);
  } catch {
    return failure(context.origin, 'validation_failed', context.correlationId);
  }
  const action = mutationAction(request);
  const keyHash = await sha256((request as { idempotencyKey: string }).idempotencyKey);
  const requestHash = await sha256(
    canonicalDocumentMutationPayload(
      request as Parameters<typeof canonicalDocumentMutationPayload>[0],
      normalized,
    ),
  );
  const targetId = (normalized.documentId ?? normalized.categoryId) as string | null;
  const expectedVersion = normalized.expectedVersion as number | null;
  const replay = await lookupReplay(dependencies, context, {
    action,
    category,
    targetId,
    expectedVersion,
    keyHash,
    requestHash,
  });
  if (!replay.success) return failure(context.origin, 'service_unavailable', context.correlationId);
  if (replay.data.decision === 'unauthorized') {
    return securityFailure(dependencies, context, 'unauthorized');
  }
  if (replay.data.decision === 'conflict') {
    return securityFailure(dependencies, context, 'idempotency_conflict', 'conflict');
  }
  const schema = category ? categoryMutationSchema : mutationSchema;
  if (replay.data.decision === 'replay' && replay.data.result) {
    return checkedResponse(
      dependencies,
      context,
      { ...replay.data.result, replayed: true, correlationId: context.correlationId },
      schema,
    );
  }
  const denied = await limited(dependencies, context, bucket);
  if (denied) return denied;
  try {
    return checkedResponse(
      dependencies,
      context,
      await invokeMutation(dependencies, context, {
        action,
        category,
        normalized,
        keyHash,
        requestHash,
      }),
      schema,
    );
  } catch (error) {
    return failure(
      context.origin,
      caughtFailureCode(error, 'service_unavailable'),
      context.correlationId,
    );
  }
}
