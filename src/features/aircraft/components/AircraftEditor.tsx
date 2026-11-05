import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  validateAircraftForm,
  type AircraftFormError,
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
import { AircraftEditorForm } from './AircraftEditorForm';
import '../../../styles/aircraft-editor-foundation.css';

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
  const [validation, setValidation] = useState<AircraftFormError[]>([]);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingAttemptRef = useRef<PendingAircraftAttempt>(undefined);

  useEffect(() => headingRef.current?.focus(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = validateAircraftForm(form);
    if (!checked.success) {
      setValidation(checked.errors);
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
    <section
      className="member-workspace aircraft-editor-foundation"
      aria-labelledby="aircraft-editor-heading"
    >
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Aircraft registry</span>
          <h2 id="aircraft-editor-heading" ref={headingRef} tabIndex={-1}>
            {record ? `Edit ${record.registrationMark}` : 'Add aircraft'}
          </h2>
        </div>
      </div>
      {message ? (
        <p className="notice notice--warning" role="alert">
          {message}
        </p>
      ) : null}
      <AircraftEditorForm
        form={form}
        onChange={setForm}
        errors={validation}
        busy={busy}
        online={online}
        onSubmit={submit}
        onCancel={onCancel}
      />
    </section>
  );
}
