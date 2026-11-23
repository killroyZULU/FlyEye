import { useState } from 'react';
import { syntheticSample, type OwnerGateway } from './owner-gateway';

function textField(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
export function OwnerLicenseForm({
  busy,
  elp,
  replacing,
  onSubmit,
}: {
  busy: boolean;
  elp: boolean;
  replacing: boolean;
  onSubmit: (fields: Parameters<OwnerGateway['submit']>[1], file: File) => void;
}) {
  const [noExpiry, setNoExpiry] = useState(false);
  const [issued, setIssued] = useState('');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const file = data.get('file');
        if (file instanceof File)
          onSubmit(
            {
              ...(elp
                ? { category: 'elp' as const, elpLevel: Number(textField(data, 'level')) }
                : {
                    licenseType: textField(data, 'type'),
                    licenseNumber: textField(data, 'number'),
                  }),
              issueDate: textField(data, 'issued'),
              expiryDate: noExpiry ? null : textField(data, 'expires'),
              noExpiry,
            },
            file,
          );
      }}
    >
      <fieldset disabled={busy}>
        <legend>
          {elp
            ? 'Submit English Language Proficiency'
            : replacing
              ? 'Replace pending mother license'
              : 'Submit a mother license'}
        </legend>
        {elp ? (
          <label>
            ELP level{' '}
            <select name="level" required defaultValue="">
              <option value="" disabled>
                Select a level
              </option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
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
          </>
        )}
        <label>
          Issue date{' '}
          <input
            name="issued"
            type="date"
            max={today}
            value={issued}
            onChange={(e) => setIssued(e.target.value)}
            required
          />
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
            Expiry date <input name="expires" type="date" min={issued || undefined} required />
          </label>
        )}
        <a download="synthetic.png" href={'data:image/png;base64,' + syntheticSample}>
          Download synthetic sample
        </a>
        <label>
          Synthetic supporting PNG <input name="file" type="file" accept="image/png" required />
        </label>
        <button>
          {elp
            ? 'Submit ELP for review'
            : replacing
              ? 'Replace pending version'
              : 'Submit for review'}
        </button>
      </fieldset>
    </form>
  );
}
