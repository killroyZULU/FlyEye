import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { AuthGateway } from '../../auth';
import {
  memberSearchSchema,
  type MemberDetail,
  type MemberStatus,
  type MemberSummary,
} from '../member-administration';
import { safeMessage } from './member-administration-ui';

type MemberDirectoryOptions = { gateway: AuthGateway; organizationId: string };
export function useMemberDirectory({ gateway, organizationId }: MemberDirectoryOptions) {
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [selected, setSelected] = useState<MemberDetail>();
  const [status, setStatus] = useState<MemberStatus | 'all'>('active');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const mounted = useRef(true);
  const requestSequence = useRef(0);

  async function loadMembers(cursor?: string, append = false): Promise<boolean> {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await gateway.loadOrganizationMembers({
        organizationId,
        status: status === 'all' ? undefined : status,
        search,
        cursor,
      });
      if (!mounted.current || sequence !== requestSequence.current) return false;
      setMembers((current) => (append ? [...current, ...result.members] : result.members));
      setNextCursor(result.nextCursor);
      if (!append) setSelected(undefined);
      return true;
    } catch (error) {
      if (mounted.current && sequence === requestSequence.current) setMessage(safeMessage(error));
      return false;
    } finally {
      if (mounted.current && sequence === requestSequence.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    const loadTimer = window.setTimeout(() => void loadMembers(), 0);
    return () => {
      window.clearTimeout(loadTimer);
      mounted.current = false;
      requestSequence.current += 1;
    };
    // Loading is intentionally keyed to the approved filter state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, organizationId, status, search]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const normalized = searchInput.trim();
    if (!normalized) {
      setSearch(undefined);
      return;
    }
    const parsed = memberSearchSchema.safeParse(normalized);
    if (!parsed.success) {
      setMessage('Search requires 2 to 80 characters, or leave it empty.');
      return;
    }
    setSearch(parsed.data);
  }

  async function loadDetail(member: MemberSummary) {
    setBusy(true);
    setMessage(undefined);
    try {
      const detail = await gateway.loadOrganizationMember(organizationId, member.membershipId);
      if (mounted.current) setSelected(detail);
    } catch (error) {
      if (mounted.current) setMessage(safeMessage(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return {
    members,
    selected,
    setSelected,
    status,
    setStatus,
    searchInput,
    setSearchInput,
    search,
    setSearch,
    nextCursor,
    busy,
    setBusy,
    message,
    setMessage,
    mounted,
    loadMembers,
    submitSearch,
    loadDetail,
  };
}
export type MemberDirectory = ReturnType<typeof useMemberDirectory>;
