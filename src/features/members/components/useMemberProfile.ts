import { type FormEvent, useEffect, useRef, useState } from 'react';

import { AuthGatewayError, type AuthGateway } from '../../auth';
import { profileFormSchema, type MemberProfile } from '../member-administration';

export type ProfileField = 'displayName' | 'contactNumber';
export type ProfileError = { field: ProfileField; message: string };

type MemberProfileOptions = {
  gateway: AuthGateway;
  membershipId: string;
};

function safeMessage(error: unknown): string {
  return error instanceof AuthGatewayError
    ? error.message
    : 'Your profile could not be verified. Try again.';
}

export function useMemberProfile({ gateway, membershipId }: MemberProfileOptions) {
  const [profile, setProfile] = useState<MemberProfile>();
  const [displayName, setDisplayName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [errors, setErrors] = useState<ProfileError[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    async function load() {
      setBusy(true);
      setMessage(undefined);
      try {
        const next = await gateway.loadMyMemberProfile(membershipId);
        if (!mounted.current) return;
        setProfile(next);
        setDisplayName(next.displayName ?? '');
        setContactNumber(next.contactNumber ?? '');
      } catch (error) {
        if (mounted.current) setMessage(safeMessage(error));
      } finally {
        if (mounted.current) setBusy(false);
      }
    }
    void load();
    return () => {
      mounted.current = false;
    };
  }, [gateway, membershipId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = profileFormSchema.safeParse({ displayName, contactNumber });
    if (!parsed.success) {
      const nextErrors = parsed.error.issues.flatMap((issue) => {
        const field = issue.path[0];
        return field === 'displayName' || field === 'contactNumber'
          ? [{ field, message: issue.message } satisfies ProfileError]
          : [];
      });
      setErrors(
        nextErrors.filter(
          (error, index) =>
            nextErrors.findIndex(
              (candidate) => candidate.field === error.field && candidate.message === error.message,
            ) === index,
        ),
      );
      setMessage('Review the highlighted profile fields.');
      return;
    }
    if (!profile) return;
    if (!navigator.onLine) {
      setMessage('You are offline. Profile changes are not queued; reconnect and try again.');
      return;
    }

    setBusy(true);
    setErrors([]);
    setMessage(undefined);
    try {
      const next = await gateway.updateMyMemberProfile({
        membershipId,
        displayName: parsed.data.displayName,
        contactNumber: parsed.data.contactNumber,
        expectedVersion: profile.version,
      });
      if (!mounted.current) return;
      setProfile(next);
      setDisplayName(next.displayName ?? '');
      setContactNumber(next.contactNumber ?? '');
      setMessage('Your organization profile was saved.');
    } catch (error) {
      if (mounted.current) setMessage(safeMessage(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return {
    profile,
    displayName,
    setDisplayName,
    contactNumber,
    setContactNumber,
    busy,
    message,
    errors,
    save,
  };
}
