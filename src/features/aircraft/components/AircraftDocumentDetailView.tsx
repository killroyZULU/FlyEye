import { type FormEvent, useState } from 'react';

import {
  documentStatusLabel,
  type AircraftDocumentDetail,
  type AircraftDocumentVersion,
} from '../aircraft-documents';

type Props = {
  detail: AircraftDocumentDetail;
  history: AircraftDocumentVersion[];
  canManage: boolean;
  canReadAttachment: boolean;
  busy: boolean;
  message?: string;
  onBack: () => void;
  onLoadMoreHistory?: () => void;
  onEdit: (mode: 'renew' | 'correct') => void;
  onLifecycle: (action: 'suspend' | 'restore', reason: string) => void;
  onDownload: (fileId: string) => void;
};

export function AircraftDocumentDetailView({
  detail,
  history,
  canManage,
  canReadAttachment,
  busy,
  message,
  onBack,
  onLoadMoreHistory,
  onEdit,
  onLifecycle,
  onDownload,
}: Props) {
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState<'suspend' | 'restore'>();

  function submitLifecycle(event: FormEvent) {
    event.preventDefault();
    if (!confirming || reason.trim().length < 10) return;
    onLifecycle(confirming, reason.trim());
  }

  return (
    <section className="member-workspace" aria-labelledby="document-detail-title">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">{detail.aircraftLabel}</span>
          <h2 id="document-detail-title">{detail.categoryLabel}</h2>
          <p>Configured record status calculated on {detail.calculatedOn}.</p>
        </div>
        <button className="text-button" type="button" onClick={onBack} disabled={busy}>
          Back to documents
        </button>
      </div>
      {message ? (
        <p className="notice notice--warning" role="alert">
          {message}
        </p>
      ) : null}
      <div className="document-status-heading">
        <span className={`document-status document-status--${detail.status}`}>
          <span aria-hidden="true">●</span> {documentStatusLabel(detail.status)}
        </span>
        <span>Expiration {detail.currentVersion.expirationDate}</span>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>Title</dt>
          <dd>{detail.currentVersion.title}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{detail.currentVersion.source}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd>{detail.currentVersion.referenceNumber ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Issue / effective date</dt>
          <dd>{detail.currentVersion.issueDate ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{detail.currentVersion.versionNumber}</dd>
        </div>
        <div>
          <dt>Record state</dt>
          <dd>{detail.documentState}</dd>
        </div>
      </dl>
      {detail.currentVersion.notes ? <p className="notice">{detail.currentVersion.notes}</p> : null}
      {canReadAttachment && detail.currentVersion.attachment ? (
        <div className="document-attachment">
          <div>
            <strong>{detail.currentVersion.attachment.displayName}</strong>
            <span>
              {detail.currentVersion.attachment.mediaType} ·{' '}
              {Math.ceil(detail.currentVersion.attachment.sizeBytes / 1024)} KiB ·{' '}
              {detail.currentVersion.attachment.scanState}
            </span>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => onDownload(detail.currentVersion.attachment!.id)}
            disabled={busy || detail.currentVersion.attachment.scanState !== 'clean'}
          >
            Download private file
          </button>
        </div>
      ) : null}
      {canManage ? (
        <div className="button-row">
          <button
            className="primary-button"
            type="button"
            onClick={() => onEdit('renew')}
            disabled={busy}
          >
            Renew
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => onEdit('correct')}
            disabled={busy}
          >
            Correct
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setConfirming(detail.documentState === 'suspended' ? 'restore' : 'suspend');
              setReason('');
            }}
            disabled={busy}
          >
            {detail.documentState === 'suspended' ? 'Restore' : 'Suspend'}
          </button>
        </div>
      ) : null}
      {confirming ? (
        <form className="confirmation-card" onSubmit={submitLifecycle}>
          <h3>
            {confirming === 'suspend' ? 'Suspend' : 'Restore'} {detail.categoryLabel}?
          </h3>
          <p>This is an administrative record action, not an aviation finding.</p>
          <label className="field">
            Administrative reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={10}
              maxLength={300}
              rows={3}
              required
              disabled={busy}
            />
          </label>
          <div className="button-row">
            <button
              className="primary-button"
              type="submit"
              disabled={busy || reason.trim().length < 10}
            >
              Confirm
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setConfirming(undefined)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      <section aria-labelledby="document-history-title">
        <div className="workspace-heading">
          <h3 id="document-history-title">Version history</h3>
        </div>
        <ol className="document-history">
          {history.map((version) => (
            <li key={version.id}>
              <strong>
                Version {version.versionNumber} · {version.versionKind}
              </strong>
              <span>
                {version.title} · expires {version.expirationDate}
              </span>
              <span>Recorded {new Date(version.createdAt).toLocaleString()}</span>
              {version.versionReason ? <span>Reason: {version.versionReason}</span> : null}
            </li>
          ))}
        </ol>
        {onLoadMoreHistory ? (
          <button type="button" onClick={onLoadMoreHistory} disabled={busy}>
            Load older versions
          </button>
        ) : null}
      </section>
    </section>
  );
}
