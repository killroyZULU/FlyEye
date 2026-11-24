import { useState } from 'react';
import type { Category, OwnerGateway } from './owner-gateway';

type Command = OwnerGateway['withdrawal'];
const categoryNames = { elp: 'ELP', ntc: 'NTC', mother_license: 'Mother license' };
type Props = {
  pendingId: string | undefined;
  busy: boolean;
  category: Category;
  execute: (
    action: Parameters<Command>[1],
    id: string,
    key: string,
    category: Props['category'],
  ) => ReturnType<Command>;
  act: (task: (generation: number) => Promise<void>) => Promise<void>;
  current: (generation: number) => boolean;
  onResult: (message: string) => void;
};
export function OwnerWithdrawal({
  pendingId,
  category,
  busy,
  execute,
  act,
  current,
  onResult,
}: Props) {
  const [intent, setIntent] = useState<{
    versionId: string;
    operationId: string;
    category: Props['category'];
  }>();
  if (!intent && !pendingId) return null;
  function handle() {
    const target =
      intent ??
      (pendingId
        ? { versionId: pendingId, operationId: crypto.randomUUID(), category }
        : undefined);
    if (!target) return;
    setIntent(target);
    void act(async (gen) => {
      const result = await execute(
        intent ? 'withdraw_outcome' : 'withdraw',
        target.versionId,
        target.operationId,
        target.category,
      );
      if (!current(gen)) return;
      setIntent(undefined);
      const message =
        result === 'withdrawn'
          ? 'Submission withdrawn.'
          : result === 'conflict'
            ? 'The selected version changed or the request conflicted. Check the refreshed list.'
            : 'Withdrawal was not recorded. Check the pending version before trying again.';
      onResult(
        target.category === category ? message : categoryNames[target.category] + ' — ' + message,
      );
    });
  }
  return (
    <button disabled={busy} onClick={handle}>
      {intent ? 'Check withdrawal outcome' : 'Withdraw pending submission'}
      {intent && intent.category !== category && ' (' + categoryNames[intent.category] + ')'}
    </button>
  );
}
