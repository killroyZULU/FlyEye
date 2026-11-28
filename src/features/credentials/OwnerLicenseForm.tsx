import { useState } from 'react';
import { syntheticSamples, type Category, type OwnerGateway } from './owner-gateway';

function textField(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
function formLabels(category: Category, replacing: boolean) {
  switch (category) {
    case 'fi':
    case 'gi': {
      const label = category === 'fi' ? 'flight instructor license' : 'ground instructor license';
      return replacing
        ? ['Replace pending ' + label, 'Replace pending ' + label]
        : ['Submit ' + label, 'Submit ' + label + ' for review'];
    }
    case 'medical':
      return replacing
        ? ['Replace pending medical certificate', 'Replace pending medical version']
        : ['Submit medical certificate', 'Submit medical certificate for review'];
    case 'ntc':
      return replacing
        ? ['Replace pending NTC radio license', 'Replace pending NTC version']
        : ['Submit NTC radio license', 'Submit NTC for review'];
    case 'elp':
      return replacing
        ? ['Replace pending English Language Proficiency', 'Replace pending ELP version']
        : ['Submit English Language Proficiency', 'Submit ELP for review'];
    case 'mother_license':
      return replacing
        ? ['Replace pending mother license', 'Replace pending version']
        : ['Submit a mother license', 'Submit for review'];
  }
}
export function OwnerLicenseForm({
  busy,
  category,
  replacing,
  onSubmit,
}: {
  busy: boolean;
  category: Category;
  replacing: boolean;
  onSubmit: (fields: Parameters<OwnerGateway['submit']>[1], file: File | File[]) => void;
}) {
  const [legend, button] = formLabels(category, replacing);
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
        const input = event.currentTarget.elements.namedItem('file');
        const files = input instanceof HTMLInputElement ? Array.from(input.files ?? []) : [];
        const fallback = data.get('file');
        const file = files.length > 1 ? files : (files[0] ?? fallback);
        if (file instanceof File || Array.isArray(file))
          onSubmit(
            {
              ...(category === 'elp'
                ? { category: 'elp' as const, elpLevel: Number(textField(data, 'level')) }
                : category !== 'mother_license'
                  ? { category }
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
        <legend>{legend}</legend>
        {category === 'elp' ? (
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
          category === 'mother_license' && (
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
          )
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
        {syntheticSamples.map(({ mime, data }) => {
          const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/jpeg' ? 'jpg' : 'png';
          return (
            <a key={mime} download={'synthetic.' + ext} href={'data:' + mime + ';base64,' + data}>
              Download synthetic {ext.toUpperCase()} sample
            </a>
          );
        })}
        <label>
          Supporting evidence (one PDF or one or two images){' '}
          <input name="file" type="file" multiple accept=".pdf,.jpg,.jpeg,.png" required />
        </label>
        <button>{button}</button>
      </fieldset>
    </form>
  );
}
