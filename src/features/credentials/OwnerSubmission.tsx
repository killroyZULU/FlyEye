import { useEffect, useRef, useState } from 'react';
import { OwnerAssuranceForm } from './OwnerAssuranceForm';
import { CredentialDeclaration } from './CredentialDeclaration';
import { OwnerWithdrawal } from './OwnerWithdrawal';
import type { Category, OwnerGateway } from './owner-gateway';
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
  const [category, setCategory] = useState<Category>('mother_license');
  const [operation, setOperation] = useState<{
    id: string;
    expectedPendingId?: string;
    category: Category;
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
  function refresh(message = '') {
    clear();
    setMessage(message);
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
      <button onClick={() => refresh()} disabled={busy}>
        Refresh submissions
      </button>
      {category !== 'mother_license' && page && (
        <CredentialDeclaration
          category={category}
          state={page[`${category}Completeness`]}
          assured={level === 'aal2'}
          busy={busy || !!operation?.check}
          declare={() =>
            void act(async (gen) => {
              await gateway.declareNotObtained(scope, category, crypto.randomUUID());
              if (gen === generation.current) refresh();
            })
          }
        />
      )}
      <OwnerWithdrawal
        key={membershipId + organizationId}
        busy={busy}
        pendingId={withdrawId}
        category={category}
        execute={gateway.withdrawal.bind(gateway, scope)}
        act={act}
        current={(gen) => generation.current === gen}
        onResult={refresh}
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
              refresh(
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
        <OwnerAssuranceForm
          busy={busy}
          onVerify={(code) =>
            void act(async (gen) => {
              await verifyTotp(code);
              if (gen === generation.current) refresh();
            })
          }
        />
      )}
      {canSubmit && !operation?.check && (
        <OwnerLicenseForm
          key={category + (pendingId ?? 'initial')}
          category={category}
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
                refresh(pendingId ? 'Pending version replaced.' : '');
              }
            })
          }
        />
      )}
    </section>
  );
}

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
    canSubmit: authorized && (category !== 'ntc' || !pendingId),
    withdrawId: authorized && category !== 'ntc' ? pendingId : undefined,
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
        onChange={(e) =>
          onChange(
            e.target.value === 'ntc' ? 'ntc' : e.target.value === 'elp' ? 'elp' : 'mother_license',
          )
        }
      >
        <option value="mother_license">Mother license</option>
        <option value="ntc">NTC radio license</option>
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
        {v.category === 'elp'
          ? `ELP Level ${v.elpLevel}`
          : v.category === 'ntc'
            ? 'NTC radio license'
            : `${v.licenseType} ${v.licenseNumber}`}{' '}
        · {v.issueDate} · {v.expiryDate ?? 'No expiry'}
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
