import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OwnerSubmission } from './OwnerSubmission';
import type { OwnerGateway } from './owner-gateway';

it('reconciles a missing replacement acknowledgement against the original pending version', async () => {
  const scope = { organizationId: crypto.randomUUID(), membershipId: crypto.randomUUID() };
  const old = {
    id: crypto.randomUUID(),
    state: 'pending' as const,
    category: 'mother_license' as const,
    licenseType: 'PPL',
    licenseNumber: 'OLD',
    issueDate: '2025-01-01',
    expiryDate: null,
  };
  const newer = { ...old, id: crypto.randomUUID(), licenseNumber: 'NEW' };
  const validUntil = new Date(Date.now() + 60000).toISOString();
  const gateway = {
    status: vi
      .fn<OwnerGateway['status']>()
      .mockResolvedValueOnce({ versions: [old], validUntil })
      .mockResolvedValue({ versions: [newer], validUntil }),
    submit: vi
      .fn<OwnerGateway['submit']>()
      .mockRejectedValue(new Error('Acknowledgement unavailable.')),
    reconcile: vi
      .fn<OwnerGateway['reconcile']>()
      .mockResolvedValue({ id: newer.id, state: 'pending' }),
    withdrawal: vi.fn(),
    evidence: vi.fn(),
  };
  render(
    <OwnerSubmission
      {...scope}
      gateway={gateway}
      getAssurance={() => Promise.resolve({ currentLevel: 'aal2', nextLevel: 'aal2' })}
      verifyTotp={vi.fn()}
    />,
  );
  const button = await screen.findByRole('button', { name: 'Replace pending version' });
  fireEvent.change(screen.getByLabelText('License number'), { target: { value: 'NEW' } });
  fireEvent.change(screen.getByLabelText('Issue date'), { target: { value: '2025-02-01' } });
  fireEvent.click(screen.getByLabelText('No expiry'));
  fireEvent.change(screen.getByLabelText('Synthetic supporting PNG'), {
    target: { files: [new File(['sample'], 'synthetic.png', { type: 'image/png' })] },
  });
  const form = button.closest('form');
  if (!form) throw Error('Missing replacement form');
  fireEvent.submit(form);
  await waitFor(() => expect(gateway.submit).toHaveBeenCalledTimes(1));
  const args = gateway.submit.mock.calls[0]!;
  expect(args[0]).toEqual(scope);
  expect('licenseNumber' in args[1] && args[1].licenseNumber).toBe('NEW');
  expect(args[4]).toBe(old.id);
  await screen.findByText('Acknowledgement unavailable.');
  fireEvent.click(screen.getByRole('button', { name: 'Check replacement outcome' }));
  expect(await screen.findByText('Replacement confirmed.')).toBeVisible();
  expect(await screen.findByText(/Pending — PPL NEW/)).toBeVisible();
  expect(gateway.reconcile.mock.calls).toEqual([[scope, args[3], old.id, 'mother_license']]);
  expect(gateway.submit).toHaveBeenCalledTimes(1);
});
