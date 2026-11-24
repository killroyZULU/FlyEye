import type { OwnerGateway } from './owner-gateway';

export function CredentialDeclaration({
  category,
  state,
  assured,
  busy,
  declare,
}: {
  category: 'elp' | 'ntc';
  state: Awaited<ReturnType<OwnerGateway['status']>>['elpCompleteness'];
  assured: boolean;
  busy: boolean;
  declare: () => void;
}) {
  const label = category.toUpperCase();
  if (state === 'not_yet_obtained') return <p>{label} — Not yet obtained</p>;
  if (state === 'required') return <p>{label} required — no approved credential on file.</p>;
  if (state === 'undeclared' && assured)
    return (
      <button disabled={busy} onClick={declare}>
        Declare {label} not yet obtained
      </button>
    );
  return null;
}
