import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OwnerSubmission } from './OwnerSubmission';
import { syntheticSample, type OwnerGateway } from './owner-gateway';

it('submits, replaces and withdraws the exact pending medical version', async () => {
  const scope = { organizationId: crypto.randomUUID(), membershipId: crypto.randomUUID() };
  const validUntil = new Date(Date.now() + 60000).toISOString();
  const status = {
    ntcCompleteness: 'undeclared' as const,
    elpCompleteness: 'not_yet_obtained' as const,
    validUntil,
    versions: [],
  };
  const medical = {
    category: 'medical' as const,
    state: 'pending' as const,
    id: crypto.randomUUID(),
    issueDate: '2020-02-01',
    expiryDate: '2023-11-30',
    noExpiry: false,
  };
  const gateway = {
    status: vi.fn<OwnerGateway['status']>().mockResolvedValue(status),
    submit: vi.fn<OwnerGateway['submit']>().mockResolvedValue({ state: 'pending', id: medical.id }),
    evidence: vi.fn(),
    reconcile: vi.fn(),
    declareNotObtained: vi.fn(),
    withdrawal: vi.fn(),
  };
  render(
    <OwnerSubmission
      {...scope}
      gateway={gateway}
      getAssurance={() => Promise.resolve({ currentLevel: 'aal2', nextLevel: 'aal2' })}
      verifyTotp={vi.fn()}
    />,
  );
  await screen.findByLabelText('License number');
  fireEvent.change(screen.getByLabelText('Credential category'), { target: { value: 'medical' } });
  await screen.findByText(/Medical certificate required/);
  expect(screen.queryByLabelText(/diagnosis|notes|license number|elp level/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /declare/i })).toBeNull();
  expect(
    screen.getByLabelText('Supporting evidence (one PDF or one or two images)'),
  ).toBeRequired();
  fireEvent.change(screen.getByLabelText('Issue date'), { target: { value: medical.issueDate } });
  fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: medical.expiryDate } });
  const form = screen
    .getByRole('button', { name: 'Submit medical certificate for review' })
    .closest('form');
  if (!form) throw Error('Expected owner form');
  gateway.status.mockResolvedValue({ ...status, versions: [medical] });
  const upload = screen.getByLabelText<HTMLInputElement>(
    'Supporting evidence (one PDF or one or two images)',
  );
  const sample = new File(
    [Uint8Array.from(atob(syntheticSample), (c) => c.charCodeAt(0))],
    'synthetic.png',
    { type: 'image/png' },
  );
  fireEvent.change(upload, { target: { files: [sample] } });
  expect(upload.files?.[0]?.size).toBe(69);
  fireEvent.submit(form);
  await waitFor(() =>
    expect(gateway.submit).toHaveBeenCalledExactlyOnceWith(
      scope,
      {
        category: 'medical',
        issueDate: medical.issueDate,
        expiryDate: medical.expiryDate,
        noExpiry: false,
      },
      expect.any(File),
      expect.any(String),
      undefined,
    ),
  );
  await screen.findByText(/Pending .*Medical certificate.*2020-02-01.*2023-11-30/);
  const successor = { ...medical, id: crypto.randomUUID(), expiryDate: '2025-11-30' };
  gateway.submit.mockResolvedValue({ state: 'pending', id: successor.id });
  gateway.status.mockResolvedValue({ ...status, versions: [successor] });
  fireEvent.change(screen.getByLabelText('Issue date'), { target: { value: successor.issueDate } });
  fireEvent.change(screen.getByLabelText('Expiry date'), {
    target: { value: successor.expiryDate },
  });
  const replacement = screen
    .getByRole('button', { name: 'Replace pending medical version' })
    .closest('form');
  if (!replacement) throw Error('Expected replacement form');
  fireEvent.change(screen.getByLabelText('Supporting evidence (one PDF or one or two images)'), {
    target: { files: [sample] },
  });
  fireEvent.submit(replacement);
  await screen.findByText(/Pending .*Medical certificate.*2025-11-30/);
  expect(gateway.submit).toHaveBeenLastCalledWith(
    scope,
    {
      category: 'medical',
      issueDate: successor.issueDate,
      expiryDate: successor.expiryDate,
      noExpiry: false,
    },
    expect.any(File),
    expect.any(String),
    medical.id,
  );
  expect(screen.getByRole('button', { name: 'View pending evidence' })).toBeVisible();
  gateway.withdrawal.mockResolvedValue('withdrawn');
  gateway.status.mockResolvedValue(status);
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw pending submission' }));
  await screen.findByRole('button', { name: 'Submit medical certificate for review' });
  expect(gateway.withdrawal).toHaveBeenCalledExactlyOnceWith(
    scope,
    'withdraw',
    successor.id,
    expect.any(String),
    'medical',
  );
  expect(screen.queryByText(/Pending .*Medical certificate/)).toBeNull();
});
