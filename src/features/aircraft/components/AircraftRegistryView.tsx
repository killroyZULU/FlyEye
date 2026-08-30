import { type FormEvent, type KeyboardEvent, useEffect, useRef } from 'react';

import type { AircraftRecord, ArchiveReason, ReactivationReason } from '../aircraft-registry';

export type AircraftConfirmation = {
  action: 'archive' | 'reactivate';
  record: AircraftRecord;
};

type AircraftRegistryViewProps = {
  organizationName: string;
  records: AircraftRecord[];
  searchInput: string;
  filtered: boolean;
  includeArchived: boolean;
  page: number;
  hasNext: boolean;
  loading: boolean;
  busy: boolean;
  online: boolean;
  canManage: boolean;
  message?: string;
  announcement?: string;
  confirmation?: AircraftConfirmation;
  reason: ArchiveReason | ReactivationReason;
  onClose: () => void;
  onSearchInput: (value: string) => void;
  onSearch: (event: FormEvent) => void;
  onIncludeArchived: (value: boolean) => void;
  onOpenEditor: (record?: AircraftRecord) => void;
  onOpenConfirmation: (
    action: AircraftConfirmation['action'],
    record: AircraftRecord,
    button: HTMLButtonElement,
  ) => void;
  onPage: (page: number) => void;
  onReason: (reason: ArchiveReason | ReactivationReason) => void;
  onConfirm: () => void;
  onCancelConfirmation: () => void;
};

const archiveOptions: Array<{ value: ArchiveReason; label: string }> = [
  { value: 'no_longer_tracked', label: 'No longer tracked' },
  { value: 'duplicate_record', label: 'Duplicate record' },
  { value: 'created_in_error', label: 'Created in error' },
];
const reactivationOptions: Array<{ value: ReactivationReason; label: string }> = [
  { value: 'tracking_resumed', label: 'Tracking resumed' },
  { value: 'archive_incorrect', label: 'Archive was incorrect' },
];

function trapConfirmationFocus(
  event: KeyboardEvent<HTMLDivElement>,
  container: HTMLDivElement | null,
  cancel: () => void,
) {
  if (event.key === 'Escape') {
    event.preventDefault();
    cancel();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [
    ...(container?.querySelectorAll<HTMLElement>(
      '[tabindex="-1"], select, button:not(:disabled)',
    ) ?? []),
  ];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function AircraftRegistryView(props: AircraftRegistryViewProps) {
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  useEffect(() => confirmationHeadingRef.current?.focus(), [props.confirmation]);
  const options = props.confirmation?.action === 'archive' ? archiveOptions : reactivationOptions;

  return (
    <section className="member-workspace" aria-labelledby="aircraft-registry-heading">
      <div inert={props.confirmation ? true : undefined} aria-hidden={Boolean(props.confirmation)}>
        <div className="workspace-heading">
          <div>
            <span className="eyebrow">{props.organizationName}</span>
            <h2 id="aircraft-registry-heading">Aircraft registry</h2>
            <p>
              Administrative identity records only. Tracked does not mean operationally available.
            </p>
          </div>
          <button className="text-button" type="button" onClick={props.onClose}>
            Back
          </button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {props.announcement}
        </p>
        {props.message && !props.confirmation ? (
          <p className="notice notice--warning" role="alert">
            {props.message}
          </p>
        ) : null}
        <form className="aircraft-filters" onSubmit={props.onSearch}>
          <label className="field aircraft-search">
            <span>Search registration, manufacturer, or model</span>
            <span className="inline-field">
              <input
                value={props.searchInput}
                onChange={(event) => props.onSearchInput(event.target.value)}
              />
              <button className="secondary-button" type="submit" disabled={props.loading}>
                Search
              </button>
            </span>
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={props.includeArchived}
              onChange={(event) => props.onIncludeArchived(event.target.checked)}
            />
            <span>Include archived</span>
          </label>
        </form>
        {props.canManage ? (
          <button
            className="primary-button"
            type="button"
            disabled={!props.online}
            onClick={() => props.onOpenEditor()}
          >
            Add aircraft
          </button>
        ) : null}
        {props.loading ? <p role="status">Loading aircraft registry…</p> : null}
        {!props.loading && props.records.length === 0 ? (
          <p className="empty-state">
            {props.filtered
              ? 'No aircraft match these filters.'
              : 'No Tracked aircraft records yet.'}
          </p>
        ) : null}
        <ul className="aircraft-list">
          {props.records.map((record) => (
            <li key={record.id}>
              <div className="aircraft-identity">
                <strong>{record.registrationMark}</strong>
                <span>
                  {record.manufacturer} · {record.model}
                </span>
              </div>
              <span className={`status-chip status-chip--${record.registryState}`}>
                {record.registryState}
              </span>
              <time dateTime={record.updatedAt}>{new Date(record.updatedAt).toLocaleString()}</time>
              {props.canManage ? (
                <div className="invitation-actions">
                  {record.registryState === 'tracked' ? (
                    <>
                      <button
                        type="button"
                        disabled={!props.online}
                        onClick={() => props.onOpenEditor(record)}
                      >
                        Edit record
                      </button>
                      <button
                        type="button"
                        disabled={!props.online}
                        onClick={(event) =>
                          props.onOpenConfirmation('archive', record, event.currentTarget)
                        }
                      >
                        Archive record
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={!props.online}
                      onClick={(event) =>
                        props.onOpenConfirmation('reactivate', record, event.currentTarget)
                      }
                    >
                      Reactivate record
                    </button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="button-row" aria-label="Registry pages">
          <button
            className="text-button"
            type="button"
            disabled={props.loading || props.page === 1}
            onClick={() => props.onPage(props.page - 1)}
          >
            Previous
          </button>
          <span>Page {props.page}</span>
          <button
            className="text-button"
            type="button"
            disabled={props.loading || !props.hasNext || props.page === 100}
            onClick={() => props.onPage(props.page + 1)}
          >
            Next
          </button>
        </div>
      </div>
      {props.confirmation ? (
        <div
          ref={confirmationRef}
          className="confirmation-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="aircraft-confirm-heading"
          onKeyDown={(event) =>
            trapConfirmationFocus(event, confirmationRef.current, props.onCancelConfirmation)
          }
        >
          <h3 id="aircraft-confirm-heading" ref={confirmationHeadingRef} tabIndex={-1}>
            {props.confirmation.action === 'archive' ? 'Archive' : 'Reactivate'}{' '}
            {props.confirmation.record.registrationMark}?
          </h3>
          {props.message ? (
            <p className="notice notice--warning" role="alert">
              {props.message}
            </p>
          ) : null}
          <p>This changes its FlyEye registry label only; it makes no operational statement.</p>
          <label className="field">
            <span>Reason</span>
            <select
              value={props.reason}
              onChange={(event) => props.onReason(event.target.value as typeof props.reason)}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button
              className={
                props.confirmation.action === 'archive' ? 'danger-button' : 'primary-button'
              }
              type="button"
              disabled={props.busy || !props.online}
              onClick={props.onConfirm}
            >
              {props.busy ? 'Saving…' : `Confirm ${props.confirmation.action}`}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={props.busy}
              onClick={props.onCancelConfirmation}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
