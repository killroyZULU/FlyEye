export function OwnerAssuranceForm({
  busy,
  onVerify,
}: {
  busy: boolean;
  onVerify: (code: string) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const code = new FormData(e.currentTarget).get('code');
        e.currentTarget.reset();
        if (typeof code === 'string') onVerify(code);
      }}
    >
      <label>
        Authenticator code{' '}
        <input name="code" autoComplete="one-time-code" pattern="[0-9]{6}" required />
      </label>
      <button disabled={busy}>Verify for evidence</button>
      <p>Enroll an authenticator in account security first if needed.</p>
    </form>
  );
}
