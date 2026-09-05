import { type FormEvent, useRef, useState } from 'react';

import {
  type AircraftDocumentDetail,
  type AircraftDocumentFormValues,
  type AircraftDocumentMutation,
  type DocumentStatusList,
} from '../aircraft-documents';
import {
  saveAircraftDocument,
  validateEditorSubmission,
  type UploadCache,
} from '../document-editor-actions';
import { AircraftDocumentError, type AircraftDocumentGateway } from '../document-gateway';
import type { PendingAircraftAttempt } from '../idempotency-retry';
import { AircraftDocumentFormFields } from './AircraftDocumentFormFields';

type StatusItem = DocumentStatusList['items'][number];

type Props = {
  gateway: AircraftDocumentGateway;
  aircraft: DocumentStatusList['aircraft'];
  item: StatusItem;
  detail?: AircraftDocumentDetail;
  mode: 'create' | 'renew' | 'correct';
  online: boolean;
  onSaved: (result: AircraftDocumentMutation) => void;
  onCancel: () => void;
  onAccessRevoked: () => void;
};

function initialValues(detail?: AircraftDocumentDetail): AircraftDocumentFormValues {
  return detail
    ? {
        documentTitle: detail.currentVersion.title,
        documentSource: detail.currentVersion.source,
        referenceNumber: detail.currentVersion.referenceNumber,
        issueDate: detail.currentVersion.issueDate,
        expirationDate: detail.currentVersion.expirationDate,
        notes: detail.currentVersion.notes,
      }
    : {
        documentTitle: '',
        documentSource: '',
        referenceNumber: '',
        issueDate: '',
        expirationDate: '',
        notes: '',
      };
}

function accessRevoked(error: unknown): boolean {
  return (
    error instanceof AircraftDocumentError &&
    ['unauthenticated', 'mfa_required', 'unauthorized'].includes(error.code)
  );
}

export function AircraftDocumentEditor({
  gateway,
  aircraft,
  item,
  detail,
  mode,
  online,
  onSaved,
  onCancel,
  onAccessRevoked,
}: Props) {
  const [values, setValues] = useState(() => initialValues(detail));
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File>();
  const [metadataOnly, setMetadataOnly] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const mutationAttempt = useRef<PendingAircraftAttempt>(undefined);
  const uploadedAttachment = useRef<UploadCache>(undefined);

  function update(name: keyof AircraftDocumentFormValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = validateEditorSubmission(values, mode, reason, file, online);
    if (!checked.success) {
      setMessages(checked.messages);
      return;
    }
    setBusy(true);
    setMessages([]);
    try {
      const result = await saveAircraftDocument({
        gateway,
        aircraftId: aircraft.id,
        categoryId: item.categoryId,
        mode,
        detail,
        values: checked,
        reason,
        file,
        metadataOnly,
        uploadCache: uploadedAttachment,
        mutationAttempt,
      });
      mutationAttempt.current = undefined;
      onSaved(result);
    } catch (error) {
      if (accessRevoked(error)) {
        onAccessRevoked();
        return;
      }
      if (file && !metadataOnly) {
        setMessages([
          error instanceof Error ? error.message : 'The attachment could not be completed.',
          'Retry the file or choose Continue without attachment.',
        ]);
      } else {
        setMessages([error instanceof Error ? error.message : 'The document could not be saved.']);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="member-workspace" aria-labelledby="document-editor-title">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">{aircraft.label}</span>
          <h2 id="document-editor-title">
            {mode === 'create' ? 'Add' : mode === 'renew' ? 'Renew' : 'Correct'}{' '}
            {item.categoryLabel}
          </h2>
          <p>
            This records FlyEye document metadata. It does not determine operational eligibility.
          </p>
        </div>
        <button className="text-button" type="button" onClick={onCancel} disabled={busy}>
          Back to documents
        </button>
      </div>
      <form className="member-form" onSubmit={(event) => void submit(event)} noValidate>
        {messages.length > 0 ? (
          <div className="validation-summary" role="alert" tabIndex={-1}>
            <strong>Review this entry</strong>
            <ul>
              {messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <AircraftDocumentFormFields
          values={values}
          reason={reason}
          mode={mode}
          file={file}
          metadataOnly={metadataOnly}
          showAttachmentFallback={messages.length > 0}
          busy={busy}
          online={online}
          onUpdate={update}
          onReasonChange={setReason}
          onFileChange={(nextFile) => {
            setFile(nextFile);
            setMetadataOnly(false);
            uploadedAttachment.current = undefined;
            mutationAttempt.current = undefined;
          }}
          onMetadataOnlyChange={setMetadataOnly}
          onCancel={onCancel}
        />
      </form>
    </section>
  );
}
