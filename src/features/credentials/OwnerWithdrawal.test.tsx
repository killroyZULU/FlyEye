import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OwnerSubmission } from './OwnerSubmission';

const scope = { organizationId: crypto.randomUUID(), membershipId: crypto.randomUUID() };
const approved = {
  id: crypto.randomUUID(),
  state: 'approved',
  category: 'mother_license',
  licenseType: 'SPL',
  licenseNumber: 'A',
  issueDate: '2024-01-01',
  expiryDate: '2028-12-31',
};
const pending = { ...approved, id: crypto.randomUUID(), state: 'pending', licenseNumber: 'B' };
function setup(level = 'aal2') {
  const validUntil = new Date(Date.now() + 60000).toISOString();
  const gateway = {
    status: vi
      .fn()
      .mockResolvedValueOnce({
        ntcCompleteness: 'undeclared',
        elpCompleteness: 'undeclared',
        versions: [approved, pending],
        validUntil,
      })
      .mockResolvedValue({
        ntcCompleteness: 'undeclared',
        elpCompleteness: 'undeclared',
        versions: [approved],
        validUntil,
      }),
    withdrawal: vi
      .fn<import('./owner-gateway').OwnerGateway['withdrawal']>()
      .mockResolvedValue('withdrawn'),
    submit: vi.fn(),
    reconcile: vi.fn(),
    declareNotObtained: vi.fn(),
    evidence: vi.fn(),
  };
  render(
    <OwnerSubmission
      {...scope}
      gateway={gateway}
      getAssurance={() => Promise.resolve({ currentLevel: level, nextLevel: 'aal2' })}
      verifyTotp={vi.fn()}
    />,
  );
  return gateway;
}
describe('My Credentials withdrawal', () => {
  it('targets the displayed pending version and refreshes the approved row and expiry', async () => {
    const gateway = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw pending submission' }));
    expect(await screen.findByText('Submission withdrawn.')).toBeVisible();
    expect(await screen.findByText(/Current approved.*2028-12-31/)).toBeVisible();
    expect(gateway.withdrawal).toHaveBeenCalledWith(
      scope,
      'withdraw',
      pending.id,
      expect.any(String),
      'mother_license',
    );
    expect(screen.queryByText(/Pending —/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Withdraw pending submission' })).toBeNull();
  });
  it('reconciles a lost response using only the original intent', async () => {
    const gateway = setup();
    gateway.withdrawal.mockRejectedValueOnce(Error('Check withdrawal outcome.'));
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw pending submission' }));
    await screen.findByText('Check withdrawal outcome.');
    fireEvent.click(screen.getByRole('button', { name: 'Check withdrawal outcome' }));
    expect(await screen.findByText('Submission withdrawn.')).toBeVisible();
    const key = gateway.withdrawal.mock.calls[0]?.[3];
    expect(gateway.withdrawal.mock.calls).toEqual([
      [scope, 'withdraw', pending.id, key, 'mother_license'],
      [scope, 'withdraw_outcome', pending.id, key, 'mother_license'],
    ]);
  });
  it('checks an ambiguous ELP withdrawal against the original ELP target after switching categories', async () => {
    const gateway = setup();
    const elp = {
      id: crypto.randomUUID(),
      category: 'elp',
      state: 'pending',
      elpLevel: 4,
      issueDate: '2020-01-02',
      expiryDate: null,
      noExpiry: true,
    };
    gateway.status.mockResolvedValue({
      versions: [pending, elp],
      validUntil: new Date(Date.now() + 60000).toISOString(),
    });
    await screen.findByText(/Pending — PPL|Pending — SPL/);
    fireEvent.change(screen.getByLabelText('Credential category'), { target: { value: 'elp' } });
    await screen.findByText(/Pending — ELP Level 4/);
    expect(screen.getByRole('button', { name: 'Replace pending ELP version' })).toBeVisible();
    gateway.withdrawal.mockRejectedValueOnce(Error('Unknown outcome.'));
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw pending submission' }));
    await screen.findByText('Unknown outcome.');
    fireEvent.change(screen.getByLabelText('Credential category'), {
      target: { value: 'mother_license' },
    });
    await screen.findByText(/Pending — SPL/);
    fireEvent.click(screen.getByRole('button', { name: 'Check withdrawal outcome (ELP)' }));
    await screen.findByText('ELP — Submission withdrawn.');
    const key = gateway.withdrawal.mock.calls[0]?.[3];
    expect(gateway.withdrawal.mock.calls).toEqual([
      [scope, 'withdraw', elp.id, key, 'elp'],
      [scope, 'withdraw_outcome', elp.id, key, 'elp'],
    ]);
  });
  it('shows the refreshed list after a stale conflict', async () => {
    const gateway = setup();
    gateway.withdrawal.mockResolvedValueOnce('conflict');
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw pending submission' }));
    expect(await screen.findByText(/request conflicted/)).toBeVisible();
    await waitFor(() => expect(gateway.status).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Submission withdrawn.')).toBeNull();
  });
  it('withholds the pending action until MFA', async () => {
    setup('aal1');
    expect(await screen.findByText(/Pending —/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Withdraw pending submission' })).toBeNull();
  });
});
