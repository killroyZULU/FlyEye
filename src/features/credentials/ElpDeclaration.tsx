import type { OwnerGateway } from './owner-gateway';

export function ElpDeclaration({
  state,
  assured,
  busy,
  declare,
}: {
  state: Awaited<ReturnType<OwnerGateway['status']>>['elpCompleteness'];
  assured: boolean;
  busy: boolean;
  declare: () => void;
}) {
  if (state === 'not_yet_obtained') return <p>ELP — Not yet obtained</p>;
  if (state === 'required') return <p>ELP required — no approved credential on file.</p>;
  if (state === 'undeclared' && assured)
    return (
      <button disabled={busy} onClick={declare}>
        Declare ELP not yet obtained
      </button>
    );
  return null;
}
