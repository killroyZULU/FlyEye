import { z } from 'zod';

const uuid = z.uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(1).max(80);
export const documentStatusSchema = z.enum([
  'missing',
  'valid',
  'expiring_soon',
  'expired',
  'suspended',
  'archived',
]);

const aircraftLabel = z.object({ id: uuid, label: z.string().min(1).max(300) }).strict();
const attachment = z
  .object({
    id: uuid,
    displayName: z.string().min(1).max(160),
    mediaType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    sizeBytes: z.number().int().positive(),
    scanState: z.enum(['staged', 'quarantined', 'clean', 'rejected', 'scan_failed']),
  })
  .strict();
const version = z
  .object({
    id: uuid,
    versionNumber: z.number().int().positive(),
    versionKind: z.enum(['create', 'renewal', 'correction']),
    title: z.string().min(1).max(160),
    source: z.string().min(1).max(160),
    referenceNumber: z.string().min(1).max(160).nullable(),
    issueDate: date.nullable(),
    expirationDate: date,
    notes: z.string().min(1).max(500).nullable(),
    versionReason: z.string().min(10).max(300).nullable(),
    createdAt: timestamp,
    hasAttachment: z.boolean(),
    attachment: attachment.nullable(),
  })
  .strict();

export const documentAircraftListSchema = z
  .object({
    decision: z.literal('listed'),
    aircraft: z.array(aircraftLabel).max(50),
    page: z.number().int().min(1).max(100),
    pageSize: z.number().int().min(1).max(50),
    hasNext: z.boolean(),
    correlationId: uuid,
  })
  .strict();
export const documentStatusListSchema = z
  .object({
    decision: z.literal('listed'),
    aircraft: aircraftLabel,
    items: z
      .array(
        z
          .object({
            categoryId: uuid,
            categoryCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
            categoryLabel: z.string().min(1).max(120),
            categoryKind: z.enum(['system', 'custom']),
            categoryVersion: z.number().int().positive().optional(),
            requirementId: uuid.nullable().optional(),
            requirementVersion: z.number().int().positive().nullable().optional(),
            documentId: uuid.nullable().optional(),
            aggregateVersion: z.number().int().positive().nullable().optional(),
            status: documentStatusSchema,
            expirationDate: date.nullable(),
            calculatedOn: date,
          })
          .strict(),
      )
      .max(100),
    availableCustomCategories: z
      .array(
        z
          .object({
            categoryId: uuid,
            categoryCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
            categoryLabel: z.string().min(1).max(120),
            categoryVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .max(100),
    calculatedOn: date,
    correlationId: uuid,
  })
  .strict();
export const documentDetailResultSchema = z
  .object({
    decision: z.literal('found'),
    document: z
      .object({
        id: uuid,
        aircraftId: uuid,
        aircraftLabel: z.string().min(1).max(300),
        categoryId: uuid,
        categoryCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
        categoryLabel: z.string().min(1).max(120),
        documentState: z.enum(['active', 'suspended', 'archived']),
        aggregateVersion: z.number().int().positive(),
        status: documentStatusSchema,
        calculatedOn: date,
        currentVersion: version,
      })
      .strict(),
    correlationId: uuid,
  })
  .strict();
export const documentHistoryResultSchema = z
  .object({
    decision: z.literal('listed'),
    items: z
      .array(
        version.extend({
          categoryCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
          categoryLabel: z.string().min(1).max(120),
        }),
      )
      .max(50),
    page: z.number().int().min(1).max(100),
    pageSize: z.number().int().min(1).max(50),
    hasNext: z.boolean(),
    correlationId: uuid,
  })
  .strict();
export const documentMutationResultSchema = z
  .object({
    decision: z.enum(['created', 'renewed', 'corrected', 'suspended', 'restored']),
    documentId: uuid,
    aggregateVersion: z.number().int().positive(),
    documentState: z.enum(['active', 'suspended', 'archived']),
    currentVersionId: uuid,
    currentVersionNumber: z.number().int().positive(),
    replayed: z.boolean(),
    correlationId: uuid,
  })
  .strict();

export const categoryMutationResultSchema = z
  .object({
    decision: z.enum([
      'category_created',
      'category_renamed',
      'category_archived',
      'category_assigned',
      'category_removed',
    ]),
    categoryId: uuid,
    categoryCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    categoryLabel: z.string().min(1).max(120),
    categoryState: z.enum(['active', 'archived']),
    categoryVersion: z.number().int().positive(),
    requirementId: uuid.nullable(),
    requirementVersion: z.number().int().positive().nullable(),
    replayed: z.boolean(),
    correlationId: uuid,
  })
  .strict();

export const notificationListResultSchema = z
  .object({
    decision: z.literal('listed'),
    items: z
      .array(
        z
          .object({
            id: uuid,
            documentId: uuid,
            documentVersionId: uuid,
            eventKind: z.enum(['warning', 'expiration']),
            state: z.enum(['open', 'read', 'resolved']),
            dueDate: date,
            aircraftRegistration: z.string().min(1).max(32),
            categoryLabel: z.string().min(1).max(120),
            expirationDate: date,
            createdAt: timestamp,
          })
          .strict(),
      )
      .max(50),
    page: z.number().int().min(1).max(100),
    pageSize: z.number().int().min(1).max(50),
    hasNext: z.boolean(),
    correlationId: uuid,
  })
  .strict();

export const notificationOpenResultSchema = z
  .object({
    decision: z.literal('opened'),
    notificationId: uuid,
    documentId: uuid,
    state: z.enum(['open', 'read', 'resolved']),
    correlationId: uuid,
  })
  .strict();

export type AircraftDocumentFormValues = {
  documentTitle: string;
  documentSource: string;
  referenceNumber?: string | null;
  issueDate?: string | null;
  expirationDate: string;
  notes?: string | null;
  storedFileId?: string | null;
};

export function validateDocumentForm(values: AircraftDocumentFormValues) {
  const messages: string[] = [];
  const documentTitle = values.documentTitle.normalize('NFC').trim();
  const documentSource = values.documentSource.normalize('NFC').trim();
  const referenceNumber = values.referenceNumber?.normalize('NFC').trim() || null;
  const notes = values.notes?.normalize('NFC').trim() || null;
  if (!documentTitle || [...documentTitle].length > 160) {
    messages.push('Enter a document title of up to 160 characters.');
  }
  if (!documentSource || [...documentSource].length > 160) {
    messages.push('Enter a source of up to 160 characters.');
  }
  if (referenceNumber && [...referenceNumber].length > 160) {
    messages.push('Keep the reference number within 160 characters.');
  }
  if (notes && [...notes].length > 500) messages.push('Keep notes within 500 characters.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.expirationDate)) {
    messages.push('Enter an expiration date.');
  }
  if (messages.length > 0) return { success: false as const, messages };
  return {
    success: true as const,
    data: {
      documentTitle,
      documentSource,
      referenceNumber,
      issueDate: values.issueDate || null,
      expirationDate: values.expirationDate,
      notes,
      storedFileId: values.storedFileId ?? null,
    },
  };
}

export function documentStatusLabel(status: z.infer<typeof documentStatusSchema>): string {
  return status === 'expiring_soon'
    ? 'Expiring Soon'
    : status.charAt(0).toUpperCase() + status.slice(1);
}

export function aircraftDocumentCapabilities(permissions: readonly string[]) {
  const has = (permission: string) => permissions.includes(permission);
  return {
    canReadDetails: has('aircraft.document.read'),
    canReadAttachment: has('aircraft.document.attachment.read'),
    canManage: has('aircraft.document.manage'),
    canManageCategories: has('aircraft.document.category.manage'),
    canReadNotifications: has('aircraft.document.notification.read'),
  };
}

export type DocumentAircraftList = z.infer<typeof documentAircraftListSchema>;
export type DocumentStatusList = z.infer<typeof documentStatusListSchema>;
export type AircraftDocumentDetail = z.infer<typeof documentDetailResultSchema>['document'];
export type AircraftDocumentVersion = z.infer<typeof version>;
export type DocumentHistoryList = z.infer<typeof documentHistoryResultSchema>;
export type DocumentNotificationList = z.infer<typeof notificationListResultSchema>;
export type AircraftDocumentMutation = z.infer<typeof documentMutationResultSchema>;
export type AircraftDocumentCategoryMutation = z.infer<typeof categoryMutationResultSchema>;
export type AircraftDocumentNotification = z.infer<
  typeof notificationListResultSchema
>['items'][number];
