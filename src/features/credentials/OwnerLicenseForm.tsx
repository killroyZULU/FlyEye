import { useState } from 'react';
import { syntheticSample, type OwnerGateway } from './owner-gateway';

function textField(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
export function OwnerLicenseForm({
  busy,
  replacing,
  onSubmit,
}: {
  busy: boolean;
  replacing: boolean;
  onSubmit: (fields: Parameters<OwnerGateway['submit']>[1], file: File) => void;
}) {
  const [noExpiry, setNoExpiry] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const file = data.get('file');
        if (file instanceof File)
          onSubmit(
            {
              licenseType: textField(data, 'type'),
              licenseNumber: textField(data, 'number'),
              issueDate: textField(data, 'issued'),
              expiryDate: noExpiry ? null : textField(data, 'expires'),
              noExpiry,
            },
            file,
          );
      }}
    >
      <fieldset disabled={busy}>
        <legend>{replacing ? 'Replace pending mother license' : 'Submit a mother license'}</legend>
        <label>
          License type{' '}
          <select name="type">
            {['SPL', 'PPL', 'CPL', 'ATPL'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          License number <input name="number" required maxLength={80} />
        </label>
        <label>
          Issue date <input name="issued" type="date" required />
        </label>
        <label>
          <input
            type="checkbox"
            checked={noExpiry}
            onChange={(e) => setNoExpiry(e.target.checked)}
          />{' '}
          No expiry
        </label>
        {!noExpiry && (
          <label>
            Expiry date <input name="expires" type="date" required />
          </label>
        )}
        <a download="synthetic.png" href={'data:image/png;base64,' + syntheticSample}>
          Download synthetic sample
        </a>
        <label>
          Synthetic supporting PNG <input name="file" type="file" accept="image/png" required />
        </label>
        <button>{replacing ? 'Replace pending version' : 'Submit for review'}</button>
      </fieldset>
    </form>
  );
}
