import { useEffect, useRef, useState } from 'react';
import { syntheticSample, type OwnerGateway } from './owner-gateway';

type Props = {
  gateway: OwnerGateway;
  organizationId: string;
  membershipId: string;
  getAssurance: () => Promise<{ currentLevel: string | null; nextLevel: string | null }>;
  verifyTotp: (code: string) => Promise<void>;
};
export function OwnerSubmission({
  gateway,
  organizationId,
  membershipId,
  getAssurance,
  verifyTotp,
}: Props) {
  const [page, setPage] = useState<Awaited<ReturnType<OwnerGateway['status']>>>();
  const [preview, setPreview] = useState<{ url: string; until: string }>();
  const [tick, reload] = useState(0),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<string | null>(null),
    [noExpiry, setNoExpiry] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const generation = useRef(0),
    form = useRef<HTMLFormElement>(null);
  const scope = { organizationId, membershipId };
  function clear() {
    generation.current++;
    setPage(undefined);
    setPreview(undefined);
    form.current?.reset();
    setNoExpiry(false);
    setBusy(false);
    setLevel(null);
  }
  useEffect(() => {
    const gen = ++generation.current;
    void Promise.all([gateway.status({ organizationId, membershipId }), getAssurance()]).then(
      ([result, assurance]) => {
        if (gen === generation.current) {
          setPage(result);
          setLevel(assurance.currentLevel);
        }
      },
      () => {
        if (gen === generation.current) {
          clear();
          setMessage('Sign in again or refresh My Credentials.');
        }
      },
    );
    const hidden = () => {
      if (document.hidden) {
        clear();
        setMessage('Refresh to view credentials.');
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      generation.current = gen + 1;
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [gateway, organizationId, membershipId, tick, getAssurance]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  useEffect(() => {
    if (!page) return;
    const timer = setTimeout(
      () => {
        clear();
        setMessage('This session needs verification.');
      },
      Math.max(0, Date.parse(preview?.until ?? page.validUntil) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [page, preview]);
  async function act(fn: (gen: number) => Promise<void>) {
    const gen = generation.current;
    setBusy(true);
    setMessage('');
    try {
      await fn(gen);
    } catch (error) {
      if (gen === generation.current) {
        clear();
        setMessage(error instanceof Error ? error.message : 'Request unavailable.');
      }
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }
  function refresh() {
    clear();
    setMessage('');
    reload((n) => n + 1);
  }
  const pending = page?.versions.some((v) => v.state === 'pending');
  return (
    <section aria-label="Mother license submissions">
      {message && <p role="status">{message}</p>}
      {!page && <button onClick={refresh}>Refresh submissions</button>}
      {operation && (
        <button
          disabled={busy}
          onClick={() =>
            void act(async (gen) => {
              const outcome = await gateway.reconcile(scope, operation);
              if (gen !== generation.current) return;
              if (outcome.state === 'pending') {
                setOperation(null);
                refresh();
                setMessage('Submission confirmed.');
              } else {
                refresh();
                setMessage(
                  'No committed submission was found. Re-select the file to retry this operation.',
                );
              }
            })
          }
        >
          Check submission outcome
        </button>
      )}
      {page?.versions.map((v) => (
        <div key={v.id}>
          <p>
            {v.state === 'pending' ? 'Pending' : 'Current approved'} — {v.licenseType}{' '}
            {v.licenseNumber} · {v.issueDate} · {v.expiryDate ?? 'No expiry'}
          </p>
          {level === 'aal2' && (
            <button
              disabled={busy}
              onClick={() =>
                void act(async (gen) => {
                  const result = await gateway.evidence(scope, v.id);
                  if (gen === generation.current)
                    setPreview({ url: URL.createObjectURL(result.blob), until: result.until });
                })
              }
            >
              View {v.state} evidence
            </button>
          )}
        </div>
      ))}
      {preview && <img alt="Submitted synthetic supporting evidence" src={preview.url} />}
      {page && level !== 'aal2' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const code = textField(new FormData(e.currentTarget), 'code');
            e.currentTarget.reset();
            void act(async (gen) => {
              await verifyTotp(code);
              if (gen === generation.current) refresh();
            });
          }}
        >
          <label>
            Authenticator code{' '}
            <input name="code" autoComplete="one-time-code" pattern="[0-9]{6}" required />
          </label>
          <button disabled={busy}>Verify for evidence</button>
          <p>Enroll an authenticator in account security first if needed.</p>
        </form>
      )}
      {page && level === 'aal2' && !pending && (
        <form
          ref={form}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const file = data.get('file');
            if (!(file instanceof File)) return;
            void act(async (gen) => {
              const key = operation ?? crypto.randomUUID();
              setOperation(key);
              await gateway.submit(
                scope,
                {
                  licenseType: textField(data, 'type'),
                  licenseNumber: textField(data, 'number'),
                  issueDate: textField(data, 'issued'),
                  expiryDate: noExpiry ? null : textField(data, 'expires'),
                  noExpiry,
                },
                file,
                key,
              );
              if (gen === generation.current) {
                setOperation(null);
                refresh();
              }
            });
          }}
        >
          <LicenseFields busy={busy} noExpiry={noExpiry} setNoExpiry={setNoExpiry} />
        </form>
      )}
    </section>
  );
}

function textField(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
function LicenseFields({
  busy,
  noExpiry,
  setNoExpiry,
}: {
  busy: boolean;
  noExpiry: boolean;
  setNoExpiry: (v: boolean) => void;
}) {
  return (
    <fieldset disabled={busy}>
      <legend>Submit a mother license</legend>
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
        <input type="checkbox" checked={noExpiry} onChange={(e) => setNoExpiry(e.target.checked)} />{' '}
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
      <button>Submit for review</button>
    </fieldset>
  );
}
