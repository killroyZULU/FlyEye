import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../lib/database.types';
import {
  categoryMutationResultSchema,
  documentAircraftListSchema,
  documentDetailResultSchema,
  documentHistoryResultSchema,
  documentMutationResultSchema,
  documentStatusListSchema,
  notificationListResultSchema,
  notificationOpenResultSchema,
  type AircraftDocumentCategoryMutation,
  type AircraftDocumentDetail,
  type AircraftDocumentFormValues,
  type AircraftDocumentMutation,
  type DocumentHistoryList,
  type DocumentNotificationList,
  type DocumentAircraftList,
  type DocumentStatusList,
} from './aircraft-documents';

export type AircraftDocumentErrorCode =
  | 'unauthenticated'
  | 'mfa_required'
  | 'recent_password_required'
  | 'unauthorized'
  | 'not_found'
  | 'validation_failed'
  | 'state_conflict'
  | 'version_conflict'
  | 'idempotency_conflict'
  | 'rate_limited'
  | 'audit_failed'
  | 'file_rejected'
  | 'scan_pending'
  | 'scan_failed'
  | 'scan_unavailable'
  | 'storage_unavailable'
  | 'service_unavailable';

export class AircraftDocumentError extends Error {
  constructor(
    public readonly code: AircraftDocumentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AircraftDocumentError';
  }
}

function message(code: AircraftDocumentErrorCode, retry?: number): string {
  const messages: Record<AircraftDocumentErrorCode, string> = {
    unauthenticated: 'Sign in again to continue.',
    mfa_required: 'Verify your authenticator to continue.',
    recent_password_required: 'Sign in with your password again to continue.',
    unauthorized: 'Your role does not include this aircraft document action.',
    not_found: 'This aircraft document record is no longer available.',
    validation_failed: 'Review the document details and try again.',
    state_conflict: 'The document is not in the required state.',
    version_conflict: 'The server record changed. Review the latest version before saving.',
    idempotency_conflict: 'This retry key was already used for different document details.',
    rate_limited: retry
      ? `Wait ${retry} seconds before trying again.`
      : 'Wait before trying again.',
    audit_failed: 'The required document audit could not be recorded.',
    file_rejected: 'The selected file did not pass validation.',
    scan_pending: 'The file is still being checked.',
    scan_failed: 'The file check failed. Continue without the file or try again.',
    scan_unavailable: 'File checking is temporarily unavailable.',
    storage_unavailable: 'Private file storage is temporarily unavailable.',
    service_unavailable: 'Aircraft documents are temporarily unavailable. Try again.',
  };
  return messages[code];
}

async function errorDetails(error: unknown) {
  if (typeof error !== 'object' || error === null) return {};
  const context: unknown = Reflect.get(error, 'context');
  if (!(context instanceof Response)) return {};
  try {
    return (
      ((await context.clone().json()) as { error?: { code?: string; retryAfterSeconds?: number } })
        .error ?? {}
    );
  } catch {
    return {};
  }
}

function normalizedCode(value?: string): AircraftDocumentErrorCode {
  const code = value?.replace('aircraft_documents.', '') as AircraftDocumentErrorCode | undefined;
  return code && code in codes ? code : 'service_unavailable';
}

const codes: Record<AircraftDocumentErrorCode, true> = {
  unauthenticated: true,
  mfa_required: true,
  recent_password_required: true,
  unauthorized: true,
  not_found: true,
  validation_failed: true,
  state_conflict: true,
  version_conflict: true,
  idempotency_conflict: true,
  rate_limited: true,
  audit_failed: true,
  file_rejected: true,
  scan_pending: true,
  scan_failed: true,
  scan_unavailable: true,
  storage_unavailable: true,
  service_unavailable: true,
};

export type AircraftDocumentMutationInput = AircraftDocumentFormValues & {
  aircraftId: string;
  categoryId: string;
  documentId?: string;
  expectedVersion?: number;
  reason?: string;
  idempotencyKey: string;
};

type LifecycleRequest = {
  aircraftId: string;
  categoryId: string;
  documentId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
};

type CategoryVersionRequest = {
  categoryId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export interface AircraftDocumentGateway {
  listAircraft(page?: number): Promise<DocumentAircraftList>;
  listStatus(aircraftId: string): Promise<DocumentStatusList>;
  detail(documentId: string): Promise<AircraftDocumentDetail>;
  history(documentId: string, page?: number): Promise<DocumentHistoryList>;
  create(request: AircraftDocumentMutationInput): Promise<AircraftDocumentMutation>;
  renew(
    request: Required<
      Pick<AircraftDocumentMutationInput, 'documentId' | 'expectedVersion' | 'reason'>
    > &
      AircraftDocumentMutationInput,
  ): Promise<AircraftDocumentMutation>;
  correct(
    request: Required<
      Pick<AircraftDocumentMutationInput, 'documentId' | 'expectedVersion' | 'reason'>
    > &
      AircraftDocumentMutationInput,
  ): Promise<AircraftDocumentMutation>;
  suspend(request: LifecycleRequest): Promise<AircraftDocumentMutation>;
  restore(request: LifecycleRequest): Promise<AircraftDocumentMutation>;
  createCategory(label: string, idempotencyKey: string): Promise<AircraftDocumentCategoryMutation>;
  renameCategory(
    request: CategoryVersionRequest & { categoryLabel: string },
  ): Promise<AircraftDocumentCategoryMutation>;
  assignCategory(
    request: CategoryVersionRequest & { aircraftId: string },
  ): Promise<AircraftDocumentCategoryMutation>;
  removeCategory(
    request: CategoryVersionRequest & { aircraftId: string },
  ): Promise<AircraftDocumentCategoryMutation>;
  archiveCategory(request: CategoryVersionRequest): Promise<AircraftDocumentCategoryMutation>;
  listNotifications(page?: number): Promise<DocumentNotificationList>;
  openNotification(notificationId: string): Promise<string>;
  upload(aircraftId: string, file: File, idempotencyKey: string): Promise<string>;
  download(fileId: string): Promise<string>;
}

export class SupabaseAircraftDocumentGateway implements AircraftDocumentGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  private async invoke(body: Record<string, unknown>): Promise<unknown> {
    const result = await this.client.functions
      .invoke('aircraft-documents', { body })
      .catch(() => null);
    if (!result)
      throw new AircraftDocumentError('service_unavailable', message('service_unavailable'));
    if (!result.error) return result.data;
    const details = await errorDetails(result.error);
    const code = normalizedCode(details.code);
    throw new AircraftDocumentError(code, message(code, details.retryAfterSeconds));
  }

  async listAircraft(page = 1) {
    return documentAircraftListSchema.parse(
      await this.invoke({ action: 'aircraft_list', page, pageSize: 25 }),
    );
  }

  async listStatus(aircraftId: string) {
    return documentStatusListSchema.parse(await this.invoke({ action: 'status_list', aircraftId }));
  }

  async detail(documentId: string) {
    return documentDetailResultSchema.parse(await this.invoke({ action: 'detail', documentId }))
      .document;
  }

  async history(documentId: string, page = 1) {
    return documentHistoryResultSchema.parse(
      await this.invoke({ action: 'history', documentId, page, pageSize: 25 }),
    );
  }

  create(request: AircraftDocumentMutationInput) {
    return this.mutation({ ...request, action: 'create' });
  }

  renew(
    request: Required<
      Pick<AircraftDocumentMutationInput, 'documentId' | 'expectedVersion' | 'reason'>
    > &
      AircraftDocumentMutationInput,
  ) {
    return this.mutation({ ...request, action: 'renew' });
  }

  correct(
    request: Required<
      Pick<AircraftDocumentMutationInput, 'documentId' | 'expectedVersion' | 'reason'>
    > &
      AircraftDocumentMutationInput,
  ) {
    return this.mutation({ ...request, action: 'correct' });
  }

  suspend(request: LifecycleRequest) {
    return this.mutation({ ...request, action: 'suspend' });
  }

  restore(request: LifecycleRequest) {
    return this.mutation({ ...request, action: 'restore' });
  }

  async createCategory(label: string, idempotencyKey: string) {
    return categoryMutationResultSchema.parse(
      await this.invoke({
        action: 'category_create',
        categoryLabel: label,
        idempotencyKey,
      }),
    );
  }

  async renameCategory(request: CategoryVersionRequest & { categoryLabel: string }) {
    return categoryMutationResultSchema.parse(
      await this.invoke({ ...request, action: 'category_rename' }),
    );
  }

  async assignCategory(request: CategoryVersionRequest & { aircraftId: string }) {
    return categoryMutationResultSchema.parse(
      await this.invoke({ ...request, action: 'category_assign' }),
    );
  }

  async removeCategory(request: CategoryVersionRequest & { aircraftId: string }) {
    return categoryMutationResultSchema.parse(
      await this.invoke({ ...request, action: 'category_remove' }),
    );
  }

  async archiveCategory(request: CategoryVersionRequest) {
    return categoryMutationResultSchema.parse(
      await this.invoke({ ...request, action: 'category_archive' }),
    );
  }

  async listNotifications(page = 1) {
    return notificationListResultSchema.parse(
      await this.invoke({
        action: 'notifications_list',
        page,
        pageSize: 25,
        includeResolved: false,
      }),
    );
  }

  async openNotification(notificationId: string) {
    return notificationOpenResultSchema.parse(
      await this.invoke({ action: 'notification_open', notificationId }),
    ).documentId;
  }

  private async mutation(body: Record<string, unknown>) {
    return documentMutationResultSchema.parse(await this.invoke(body));
  }

  async upload(aircraftId: string, file: File, idempotencyKey: string): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer),
    );
    const sha256Hash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const staged = (await this.invoke({
      action: 'file_initiate',
      aircraftId,
      displayName: file.name,
      mediaType: file.type,
      sizeBytes: file.size,
      sha256Hash,
      idempotencyKey,
    })) as {
      decision?: string;
      fileId?: string;
      uploadPath?: string;
      uploadToken?: string;
      scanState?: string;
    };
    if (staged.decision === 'completed' && staged.fileId && staged.scanState === 'clean') {
      return staged.fileId;
    }
    if (!staged.fileId || !staged.uploadPath || !staged.uploadToken) {
      throw new AircraftDocumentError('storage_unavailable', message('storage_unavailable'));
    }
    const uploaded = await this.client.storage
      .from('aircraft-documents')
      .uploadToSignedUrl(staged.uploadPath, staged.uploadToken, file, { contentType: file.type });
    let completed: { decision?: string; fileId?: string };
    try {
      completed = (await this.invoke({
        action: 'file_complete',
        fileId: staged.fileId,
        idempotencyKey,
      })) as { decision?: string; fileId?: string };
    } catch (error) {
      if (uploaded.error) {
        throw new AircraftDocumentError('storage_unavailable', message('storage_unavailable'));
      }
      throw error;
    }
    if (completed.decision !== 'completed' || completed.fileId !== staged.fileId) {
      throw new AircraftDocumentError('file_rejected', message('file_rejected'));
    }
    return staged.fileId;
  }

  async download(fileId: string): Promise<string> {
    const result = (await this.invoke({ action: 'attachment_download', fileId })) as {
      signedUrl?: string;
    };
    if (!result.signedUrl) {
      throw new AircraftDocumentError('storage_unavailable', message('storage_unavailable'));
    }
    return result.signedUrl;
  }
}
