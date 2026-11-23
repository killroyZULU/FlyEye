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
  const [category, setCategory] = useState<'mother_license' | 'elp'>('mother_license');
  const [operation, setOperation] = useState<{
    id: string;
    expectedPendingId?: string;
    category: 'mother_license' | 'elp';
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
  const { rows, pendingId, canSubmit, withdrawId } = categoryView(page, category, level);
  return (
    <section aria-label="Owner credential submissions">
      <CategorySelect
        category={category}
        disabled={busy || !!operation?.check}
        onChange={(value) => {
          setCategory(value);
          refresh();
        }}
      />
      {message && <p role="status">{message}</p>}
      <button onClick={refresh} disabled={busy}>
        Refresh submissions
      </button>
      <OwnerWithdrawal
        key={membershipId + organizationId}
        busy={busy}
        pendingId={withdrawId}
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
                operation.category,
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
      <OwnerVersions
        rows={rows}
        canPreview={level === 'aal2'}
        busy={busy}
        onView={(id) =>
          void act(async (gen) => {
            const result = await gateway.evidence(scope, id);
            if (gen === generation.current)
              setPreview({ url: URL.createObjectURL(result.blob), until: result.until });
          })
        }
      />
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
      {canSubmit && !operation?.check && (
        <OwnerLicenseForm
          key={category + (pendingId ?? 'initial')}
          elp={category === 'elp'}
          busy={busy}
          replacing={!!pendingId}
          onSubmit={(fields, file) =>
            void act(async (gen) => {
              const id =
                operation &&
                operation.category === category &&
                operation.expectedPendingId === pendingId
                  ? operation.id
                  : crypto.randomUUID();
              setOperation({ id, expectedPendingId: pendingId, category, check: true });
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

type Category = 'mother_license' | 'elp';
function categoryView(
  page: Awaited<ReturnType<OwnerGateway['status']>> | undefined,
  category: Category,
  level: string | null,
) {
  const rows = page?.versions.filter((v) => v.category === category);
  const pendingId = rows?.find((v) => v.state === 'pending')?.id;
  const authorized = !!page && level === 'aal2';
  return {
    rows,
    pendingId,
    canSubmit: authorized && !(category === 'elp' && pendingId),
    withdrawId: authorized && category === 'mother_license' ? pendingId : undefined,
  };
}
function CategorySelect({
  category,
  disabled,
  onChange,
}: {
  category: Category;
  disabled: boolean;
  onChange: (value: Category) => void;
}) {
  return (
    <label>
      Credential category{' '}
      <select
        value={category}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === 'elp' ? 'elp' : 'mother_license')}
      >
        <option value="mother_license">Mother license</option>
        <option value="elp">English Language Proficiency (ELP)</option>
      </select>
    </label>
  );
}
function OwnerVersions({
  rows,
  canPreview,
  busy,
  onView,
}: {
  rows: Awaited<ReturnType<OwnerGateway['status']>>['versions'] | undefined;
  canPreview: boolean;
  busy: boolean;
  onView: (id: string) => void;
}) {
  return rows?.map((v) => (
    <div key={v.id}>
      <p>
        {v.state === 'pending' ? 'Pending' : 'Current approved'} —{' '}
        {v.category === 'elp' ? `ELP Level ${v.elpLevel}` : `${v.licenseType} ${v.licenseNumber}`} ·{' '}
        {v.issueDate} · {v.expiryDate ?? 'No expiry'}
      </p>
      {canPreview && (
        <button disabled={busy} onClick={() => onView(v.id)}>
          View {v.state} evidence
        </button>
      )}
    </div>
  ));
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
