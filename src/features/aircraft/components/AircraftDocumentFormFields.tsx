import type { AircraftDocumentFormValues } from '../aircraft-documents';

type Props = {
  values: AircraftDocumentFormValues;
  reason: string;
  mode: 'create' | 'renew' | 'correct';
  file?: File;
  metadataOnly: boolean;
  showAttachmentFallback: boolean;
  busy: boolean;
  online: boolean;
  onUpdate: (name: keyof AircraftDocumentFormValues, value: string) => void;
  onReasonChange: (value: string) => void;
  onFileChange: (file?: File) => void;
  onMetadataOnlyChange: (checked: boolean) => void;
  onCancel: () => void;
};

function submitLabel(mode: Props['mode'], busy: boolean): string {
  if (busy) return 'Saving…';
  if (mode === 'create') return 'Add document';
  return mode === 'renew' ? 'Save renewal' : 'Save correction';
}

export function AircraftDocumentFormFields({
  values,
  reason,
  mode,
  file,
  metadataOnly,
  showAttachmentFallback,
  busy,
  online,
  onUpdate,
  onReasonChange,
  onFileChange,
  onMetadataOnlyChange,
  onCancel,
}: Props) {
  return (
    <>
      <label className="field">
        Document title
        <input
          value={values.documentTitle}
          onChange={(event) => onUpdate('documentTitle', event.target.value)}
          maxLength={160}
          disabled={busy}
          required
        />
      </label>
      <label className="field">
        Source or issuing authority
        <input
          value={values.documentSource}
          onChange={(event) => onUpdate('documentSource', event.target.value)}
          maxLength={160}
          disabled={busy}
          required
        />
      </label>
      <div className="document-form-grid">
        <label className="field">
          Reference number <span className="field-guidance">Optional</span>
          <input
            value={values.referenceNumber ?? ''}
            onChange={(event) => onUpdate('referenceNumber', event.target.value)}
            maxLength={160}
            disabled={busy}
          />
        </label>
        <label className="field">
          Issue or effective date <span className="field-guidance">Optional</span>
          <input
            type="date"
            value={values.issueDate ?? ''}
            onChange={(event) => onUpdate('issueDate', event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          Expiration date
          <input
            type="date"
            value={values.expirationDate}
            onChange={(event) => onUpdate('expirationDate', event.target.value)}
            disabled={busy}
            required
          />
        </label>
      </div>
      <label className="field">
        Notes <span className="field-guidance">Optional, 500 characters</span>
        <textarea
          value={values.notes ?? ''}
          onChange={(event) => onUpdate('notes', event.target.value)}
          maxLength={500}
          rows={4}
          disabled={busy}
        />
      </label>
      {mode !== 'create' ? (
        <label className="field">
          Administrative reason
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            minLength={10}
            maxLength={300}
            rows={3}
            disabled={busy}
            required
          />
        </label>
      ) : null}
      <label className="field">
        Private attachment{' '}
        <span className="field-guidance">Optional PDF, JPEG, or PNG; 20 MiB maximum</span>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(event) => onFileChange(event.target.files?.[0])}
          disabled={busy}
        />
      </label>
      {file && showAttachmentFallback ? (
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={metadataOnly}
            onChange={(event) => onMetadataOnlyChange(event.target.checked)}
            disabled={busy}
          />
          Continue without attachment
        </label>
      ) : null}
      <div className="button-row">
        <button className="primary-button" type="submit" disabled={busy || !online}>
          {submitLabel(mode, busy)}
        </button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </>
  );
}
