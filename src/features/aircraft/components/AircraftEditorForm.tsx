import { type FormEvent, useEffect, useRef } from 'react';

import type { AircraftFormError, AircraftFormValues } from '../aircraft-registry';

const fields = [
  { key: 'registrationMark', label: 'Registration mark', limit: 32 },
  { key: 'manufacturer', label: 'Manufacturer', limit: 100 },
  { key: 'model', label: 'Model', limit: 100 },
] as const;

type Props = {
  form: AircraftFormValues;
  errors: AircraftFormError[];
  busy: boolean;
  online: boolean;
  onChange: (values: AircraftFormValues) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
  onCancel: () => void;
};

export function AircraftEditorForm({
  form,
  errors,
  busy,
  online,
  onChange,
  onSubmit,
  onCancel,
}: Props) {
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length) summaryRef.current?.focus();
  }, [errors]);

  return (
    <form className="member-form" noValidate onSubmit={(event) => void onSubmit(event)}>
      {errors.length > 0 ? (
        <div className="validation-summary" role="alert" tabIndex={-1} ref={summaryRef}>
          <strong>Review these details:</strong>
          <ul>
            {errors.map(({ field, message }) => (
              <li key={field}>
                <a
                  href={`#aircraft-${field}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(`aircraft-${field}`)?.focus();
                  }}
                >
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {fields.map(({ key, label, limit }) => {
        const error = errors.find((item) => item.field === key);
        const id = `aircraft-${key}`;
        return (
          <div className="field-group" key={key}>
            <label htmlFor={id}>{label}</label>
            <input
              id={id}
              value={form[key]}
              required
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={`${id}-guidance${error ? ` ${id}-error` : ''}`}
              onChange={(event) => onChange({ ...form, [key]: event.target.value })}
            />
            <span className="field-guidance" id={`${id}-guidance`}>
              Required, up to {limit} characters.
            </span>
            {error ? (
              <span className="field-error" id={`${id}-error`}>
                {error.message}
              </span>
            ) : null}
          </div>
        );
      })}
      <div className="button-row">
        <button className="primary-button" type="submit" disabled={busy || !online}>
          {busy ? 'Saving…' : 'Save record'}
        </button>
        <button className="text-button" type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="sr-only" role="status">
        {busy ? 'Saving aircraft record.' : ''}
      </p>
      {!online ? (
        <p className="notice notice--warning">
          Reconnect before saving. Changes are not queued offline.
        </p>
      ) : null}
    </form>
  );
}
