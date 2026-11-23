import { useState } from 'react';
import type { OwnerGateway } from './owner-gateway';

type Command = OwnerGateway['withdrawal'];
type Props = {
  pendingId: string | undefined;
  busy: boolean;
  execute: (action: Parameters<Command>[1], id: string, key: string) => ReturnType<Command>;
  act: (task: (generation: number) => Promise<void>) => Promise<void>;
  current: (generation: number) => boolean;
  onResult: (message: string) => void;
};
export function OwnerWithdrawal({ pendingId, busy, execute, act, current, onResult }: Props) {
  const [intent, setIntent] = useState<{ versionId: string; operationId: string }>();
  if (!intent && !pendingId) return null;
  function handle() {
    const target =
      intent ??
      (pendingId ? { versionId: pendingId, operationId: crypto.randomUUID() } : undefined);
    if (!target) return;
    setIntent(target);
    void act(async (gen) => {
      const result = await execute(
        intent ? 'withdraw_outcome' : 'withdraw',
        target.versionId,
        target.operationId,
      );
      if (!current(gen)) return;
      setIntent(undefined);
      onResult(
        result === 'withdrawn'
          ? 'Submission withdrawn.'
          : result === 'conflict'
            ? 'The selected version changed or the request conflicted. Check the refreshed list.'
            : 'Withdrawal was not recorded. Check the pending version before trying again.',
      );
    });
  }
  return (
    <button disabled={busy} onClick={handle}>
      {intent ? 'Check withdrawal outcome' : 'Withdraw pending submission'}
    </button>
  );
}
