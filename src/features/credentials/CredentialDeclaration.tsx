import type { Category, OwnerGateway } from './owner-gateway';

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

export function OwnerCompleteness({
  page,
  category,
  assured,
  busy,
  onDeclare,
}: {
  page: Awaited<ReturnType<OwnerGateway['status']>> | undefined;
  category: Category;
  assured: boolean;
  busy: boolean;
  onDeclare: (category: 'elp' | 'ntc') => void;
}) {
  if (!page || category === 'mother_license') return null;
  if (category === 'medical') {
    return page.versions.some((v) => v.category === category && v.state === 'approved') ? null : (
      <p>Medical certificate required — no approved certificate on file.</p>
    );
  }
  return (
    <CredentialDeclaration
      category={category}
      state={page[`${category}Completeness`]}
      assured={assured}
      busy={busy}
      declare={() => onDeclare(category)}
    />
  );
}
