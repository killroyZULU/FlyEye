import { useEffect, useState } from 'react';
import type { AccessMembership } from '../../lib/access-context';
import type { CredentialRequest, CredentialResult } from './workspace';

type Gateway = { credentialWorkspace(request: CredentialRequest): Promise<CredentialResult> };
type Member = CredentialResult['members'][number];
const choices = {
  trainee: 'Trainee',
  instructor: 'Instructor',
  both: 'Trainee and instructor',
} as const;

function Requirements({ member }: { member: Member }) {
  if (!member.applicability)
    return <p>Your administrator has not set your credential applicability yet.</p>;
  const instructor = member.applicability !== 'trainee';
  return (
    <>
      <p>{choices[member.applicability]}</p>
      <p>No credentials on record.</p>
      <ul>
        <li>Mother license — required</li>
        <li>Medical certificate — required</li>
        <li>NTC radio license — {instructor ? 'required' : 'may be marked not yet obtained'}</li>
        <li>ELP — {instructor ? 'required' : 'may be marked not yet obtained'}</li>
        {instructor && (
          <>
            <li>Flight instructor license (FI) — optional</li>
            <li>Ground instructor license (GI) — optional</li>
          </>
        )}
      </ul>
    </>
  );
}

function ApplicabilityForm({
  member,
  save,
  disabled,
}: {
  member: Member;
  save: (value: NonNullable<Member['applicability']>) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState<Member['applicability']>(member.applicability);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (value && value !== member.applicability) save(value);
      }}
    >
      <label>
        Applicability{' '}
        <select
          disabled={disabled}
          value={value ?? ''}
          onChange={(event) => {
            const key = event.target.value;
            if (key === 'trainee' || key === 'instructor' || key === 'both') setValue(key);
          }}
        >
          <option value="" disabled>
            Select applicability
          </option>
          {Object.entries(choices).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button disabled={disabled || !value || value === member.applicability}>
        Save applicability
      </button>
    </form>
  );
}

export function CredentialPanel({
  gateway,
  membership,
  personnel,
}: {
  gateway: Gateway;
  membership: AccessMembership;
  personnel: boolean;
}) {
  const { organizationId, membershipId } = membership;
  const [page, setPage] = useState<CredentialResult>();
  const [after, setAfter] = useState<string>();
  const [revision, refresh] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let current = true;
    const req: CredentialRequest = personnel
      ? { action: 'personnel_credentials', organizationId, after }
      : { action: 'my_credentials', organizationId, membershipId };
    void gateway.credentialWorkspace(req).then(
      (data) => {
        if (current) setPage(data);
      },
      (reason) => {
        if (current)
          setError(
            reason instanceof Error ? reason.message : 'Credential information is unavailable.',
          );
      },
    );
    return () => {
      current = false;
    };
  }, [gateway, organizationId, membershipId, personnel, after, revision]);
  function reload(cursor: string | undefined) {
    setPage(undefined);
    setError('');
    setAfter(cursor);
    refresh((n) => n + 1);
  }
  async function save(member: Member, value: NonNullable<Member['applicability']>) {
    setSaving(true);
    try {
      await gateway.credentialWorkspace({
        action: 'set_credential_applicability',
        organizationId,
        membershipId: member.membershipId,
        expectedVersion: member.version,
        applicability: value,
      });
      reload(after);
    } catch (reason) {
      setPage(undefined);
      setError(
        reason instanceof Error
          ? reason.message
          : 'The change could not be confirmed. Refresh before trying again.',
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="workspace-panel" aria-labelledby="credential-heading">
      <h1 id="credential-heading">{personnel ? 'Personnel Credentials' : 'My Credentials'}</h1>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button onClick={() => reload(after)}>Refresh credentials</button>
        </>
      ) : !page ? (
        <p role="status">Loading credentials…</p>
      ) : !personnel && page.members[0] ? (
        <Requirements member={page.members[0]} />
      ) : (
        <>
          <p>No personnel credentials on record.</p>
          {page.members.map((member) => (
            <section key={member.membershipId}>
              <h2>{member.displayName ?? 'Unnamed school member'}</h2>
              <p>Membership {member.membershipId}</p>
              <p>
                {member.applicability ? choices[member.applicability] : 'Applicability not set'}
              </p>
              {membership.permissions.includes('credential.applicability.manage') && (
                <ApplicabilityForm
                  key={member.version}
                  member={member}
                  disabled={saving}
                  save={(value) => void save(member, value)}
                />
              )}
            </section>
          ))}
          {after && (
            <button disabled={saving} onClick={() => reload(undefined)}>
              First page
            </button>
          )}
          {page.hasMore && (
            <button disabled={saving} onClick={() => reload(page.members.at(-1)?.membershipId)}>
              Next page
            </button>
          )}
        </>
      )}
    </section>
  );
}
