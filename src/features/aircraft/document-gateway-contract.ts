import type {
  AircraftDocumentCategoryMutation,
  AircraftDocumentDetail,
  AircraftDocumentFormValues,
  AircraftDocumentMutation,
  DocumentHistoryList,
  DocumentNotificationList,
  DocumentAircraftList,
  DocumentStatusList,
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

export type AircraftDocumentMutationInput = AircraftDocumentFormValues & {
  aircraftId: string;
  categoryId: string;
  documentId?: string;
  expectedVersion?: number;
  reason?: string;
  idempotencyKey: string;
};

export type LifecycleRequest = {
  aircraftId: string;
  categoryId: string;
  documentId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
};

export type CategoryVersionRequest = {
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
