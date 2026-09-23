import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  validateAircraftForm,
  type AircraftFormValues,
  type AircraftMutationResult,
  type AircraftRecord,
} from '../aircraft-registry';
import {
  AircraftRegistryError,
  isAircraftAccessRevoked,
  type AircraftRegistryGateway,
} from '../gateway';
import {
  idempotencyKeyForAttempt,
  releaseDefinitiveAttempt,
  type PendingAircraftAttempt,
} from '../idempotency-retry';

type AircraftEditorProps = {
  gateway: AircraftRegistryGateway;
  record?: AircraftRecord;
  online: boolean;
  onSaved: (result: AircraftMutationResult) => Promise<void>;
  onCancel: () => void;
  onAccessRevoked: () => void;
};

const emptyForm: AircraftFormValues = { registrationMark: '', manufacturer: '', model: '' };

function safeMessage(error: unknown): string {
  return error instanceof AircraftRegistryError
    ? error.message
    : 'The aircraft registry is temporarily unavailable. Try again.';
}

export function AircraftEditor({
  gateway,
  record,
  online,
  onSaved,
  onCancel,
  onAccessRevoked,
}: AircraftEditorProps) {
  const [form, setForm] = useState<AircraftFormValues>(
    record
      ? {
          registrationMark: record.registrationMark,
          manufacturer: record.manufacturer,
          model: record.model,
        }
      : emptyForm,
  );
  const [validation, setValidation] = useState<string[]>([]);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingAttemptRef = useRef<PendingAircraftAttempt>(undefined);

  useEffect(() => headingRef.current?.focus(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = validateAircraftForm(form);
    if (!checked.success) {
      setValidation(checked.messages);
      return;
    }
    if (!online) return;
    setBusy(true);
    setValidation([]);
    setMessage(undefined);
    const idempotencyKey = idempotencyKeyForAttempt(pendingAttemptRef, {
      action: record ? 'update' : 'create',
      recordId: record?.id,
      expectedVersion: record?.version,
      ...checked.data,
    });
    try {
      const result = record
        ? await gateway.update({
            ...checked.data,
            recordId: record.id,
            expectedVersion: record.version,
            idempotencyKey,
          })
        : await gateway.create({ ...checked.data, idempotencyKey });
      pendingAttemptRef.current = undefined;
      await onSaved(result);
    } catch (error) {
      if (isAircraftAccessRevoked(error)) {
        pendingAttemptRef.current = undefined;
        onAccessRevoked();
        return;
      }
      releaseDefinitiveAttempt(pendingAttemptRef, error);
      setMessage(safeMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="member-workspace" aria-labelledby="aircraft-editor-heading">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Aircraft registry</span>
          <h2 id="aircraft-editor-heading" ref={headingRef} tabIndex={-1}>
            {record ? `Edit ${record.registrationMark}` : 'Add aircraft'}
          </h2>
        </div>
      </div>
      {validation.length > 0 ? (
        <div className="validation-summary" role="alert">
          <strong>Review these details:</strong>
          <ul>
            {validation.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {message ? (
        <p className="notice notice--warning" role="alert">
          {message}
        </p>
      ) : null}
      <form className="member-form" onSubmit={(event) => void submit(event)}>
        {(['registrationMark', 'manufacturer', 'model'] as const).map((field) => (
          <label className="field" key={field}>
            <span>
              {field === 'registrationMark'
                ? 'Registration mark'
                : field[0]!.toUpperCase() + field.slice(1)}
            </span>
            <input
              value={form[field]}
              onChange={(event) => setForm({ ...form, [field]: event.target.value })}
              disabled={busy}
              required
            />
          </label>
        ))}
        <div className="button-row">
          <button className="primary-button" type="submit" disabled={busy || !online}>
            {busy ? 'Saving…' : 'Save record'}
          </button>
          <button className="text-button" type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
        {!online ? (
          <p className="notice notice--warning">
            Reconnect before saving. Changes are not queued offline.
          </p>
        ) : null}
      </form>
    </section>
  );
}
