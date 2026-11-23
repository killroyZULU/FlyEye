import { useEffect, useRef, useState } from 'react';
import { OwnerWithdrawal } from './OwnerWithdrawal';
import type { OwnerGateway } from './owner-gateway';
import { OwnerLicenseForm } from './OwnerLicenseForm';

type Props = {
  gateway: OwnerGateway;
  organizationId: string;
  membershipId: string;
  getAssurance: () => Promise<{ currentLevel: string | null; nextLevel: string | null }>;
  verifyTotp: (code: string) => Promise<void>;
};
export function OwnerSubmission(props: Props) {
  const { gateway, organizationId, membershipId, getAssurance, verifyTotp } = props;
  const [page, setPage] = useState<Awaited<ReturnType<OwnerGateway['status']>>>();
  const [preview, setPreview] = useState<{ url: string; until: string }>();
  usePreviewCleanup(preview?.url);
  const [tick, reload] = useState(0),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<string | null>(null);
  const [operation, setOperation] = useState<{
    id: string;
    expectedPendingId?: string;
    check: boolean;
  }>();
  const generation = useRef(0);
  const scope = { organizationId, membershipId };
  function clear() {
    generation.current++;
    setPage(undefined);
    setPreview(undefined);
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
  const pendingId = page?.versions.find((v) => v.state === 'pending')?.id;
  return (
    <section aria-label="Mother license submissions">
      {message && <p role="status">{message}</p>}
      {!page && <button onClick={refresh}>Refresh submissions</button>}
      <OwnerWithdrawal
        key={membershipId + organizationId}
        busy={busy}
        pendingId={level === 'aal2' ? pendingId : undefined}
        execute={(action, id, key) => gateway.withdrawal(scope, action, id, key)}
        act={act}
        current={(gen) => generation.current === gen}
        onResult={(text) => {
          refresh();
          setMessage(text);
        }}
      />
      {operation?.check && (
        <button
          disabled={busy}
          onClick={() =>
            void act(async (gen) => {
              const outcome = await gateway.reconcile(
                scope,
                operation.id,
                operation.expectedPendingId,
              );
              if (gen !== generation.current) return;
              setOperation(
                outcome.state === 'unconfirmed' ? { ...operation, check: false } : undefined,
              );
              refresh();
              setMessage(
                outcome.state === 'pending' && operation.expectedPendingId
                  ? 'Replacement confirmed.'
                  : submissionOutcomeMessage(outcome.state),
              );
            })
          }
        >
          {operation.expectedPendingId ? 'Check replacement outcome' : 'Check submission outcome'}
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
      {page && level === 'aal2' && !operation?.check && (
        <OwnerLicenseForm
          key={pendingId ?? 'initial'}
          busy={busy}
          replacing={!!pendingId}
          onSubmit={(fields, file) =>
            void act(async (gen) => {
              const id =
                operation && operation.expectedPendingId === pendingId
                  ? operation.id
                  : crypto.randomUUID();
              setOperation({ id, expectedPendingId: pendingId, check: true });
              await gateway.submit(scope, fields, file, id, pendingId);
              if (gen === generation.current) {
                setOperation(undefined);
                refresh();
                if (pendingId) setMessage('Pending version replaced.');
              }
            })
          }
        />
      )}
    </section>
  );
}

function usePreviewCleanup(url: string | undefined) {
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
}

function submissionOutcomeMessage(state: 'unconfirmed' | 'withdrawn' | 'pending') {
  if (state === 'unconfirmed')
    return 'No committed submission was found. Re-select the file to retry this operation.';
  return state === 'withdrawn' ? 'Submission was withdrawn.' : 'Submission confirmed.';
}
function textField(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
