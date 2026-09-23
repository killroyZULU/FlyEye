import { z } from 'zod';

const uuid = z.uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().min(1).max(80);
const status = z.enum(['missing', 'valid', 'expiring_soon', 'expired', 'suspended', 'archived']);

export const aircraftListSchema = z
  .object({
    decision: z.literal('listed'),
    aircraft: z.array(z.object({ id: uuid, label: z.string().min(1).max(300) }).strict()).max(50),
    page: z.number().int().min(1).max(100),
    pageSize: z.number().int().min(1).max(50),
    hasNext: z.boolean(),
    correlationId: uuid,
  })
  .strict();

export const contextSchema = z
  .object({
    organizationId: uuid,
    membershipId: uuid,
    roleCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    canReadStatus: z.boolean(),
    canRead: z.boolean(),
    canReadNotifications: z.boolean(),
    canManage: z.boolean(),
    canManageCategories: z.boolean(),
    canReadAttachment: z.boolean(),
  })
  .strict();

const attachment = z
  .object({
    id: uuid,
    displayName: z.string().min(1).max(160),
    mediaType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(20 * 1024 * 1024),
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

export const statusListSchema = z
  .object({
    decision: z.literal('listed'),
    aircraft: z.object({ id: uuid, label: z.string().min(1).max(300) }).strict(),
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
            status,
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

export const detailSchema = z
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
        status,
        calculatedOn: date,
        currentVersion: version,
      })
      .strict(),
    correlationId: uuid,
  })
  .strict();

export const historySchema = z
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

export const notificationListSchema = z
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

export const notificationOpenSchema = z
  .object({
    decision: z.literal('opened'),
    notificationId: uuid,
    documentId: uuid,
    state: z.enum(['open', 'read', 'resolved']),
    correlationId: uuid,
  })
  .strict();

export const mutationSchema = z
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

export const categoryMutationSchema = z
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

export const fileStageSchema = z
  .object({
    decision: z.literal('staged'),
    fileId: uuid,
    objectKey: z.string().min(1).max(200),
    scanState: z.enum(['staged', 'quarantined', 'clean', 'rejected', 'scan_failed']),
    correlationId: uuid,
  })
  .strict();

export const fileCompleteSchema = z
  .object({
    decision: z.literal('completed'),
    fileId: uuid,
    scanState: z.literal('clean'),
    correlationId: uuid,
  })
  .strict();

export const downloadTargetSchema = z
  .object({
    decision: z.literal('authorized'),
    fileId: uuid,
    bucketId: z.literal('aircraft-documents'),
    objectKey: z.string().min(1).max(200),
    downloadName: z.string().min(1).max(160),
    mediaType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    correlationId: uuid,
  })
  .strict();

export const downloadConfirmationSchema = z
  .object({
    decision: z.literal('confirmed'),
    fileId: uuid,
    correlationId: uuid,
  })
  .strict();

export const stagedFileSchema = z
  .object({
    decision: z.literal('found'),
    fileId: uuid,
    objectKey: z.string().min(1).max(200),
    mediaType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(20 * 1024 * 1024),
    sha256Hash: z.string().regex(/^[0-9a-f]{64}$/),
    scanState: z.enum(['staged', 'quarantined', 'clean', 'rejected', 'scan_failed']),
  })
  .strict();

export const idempotencySchema = z
  .object({
    decision: z.enum(['missing', 'replay', 'conflict', 'unauthorized']),
    result: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();
