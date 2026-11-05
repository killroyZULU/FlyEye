import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AircraftRegistryError, type AircraftRegistryGateway } from '../gateway';
import { AircraftEditor } from './AircraftEditor';

const record = {
  id: '50000000-0000-4000-8000-000000000001',
  registrationMark: 'DEMO-001',
  manufacturer: 'Synthetic Manufacturer',
  model: 'Synthetic Model',
  registryState: 'tracked' as const,
  version: 4,
  updatedAt: '2026-10-24T00:00:00Z',
};
const result = {
  decision: 'created' as const,
  record,
  replayed: false,
  correlationId: 'synthetic',
};

function setup(
  options: { edit?: boolean; online?: boolean; create?: AircraftRegistryGateway['create'] } = {},
) {
  const create = vi.fn(options.create ?? (() => Promise.resolve(result)));
  const update = vi.fn().mockResolvedValue({ ...result, decision: 'updated' });
  const gateway: AircraftRegistryGateway = {
    create,
    update,
    get: vi.fn(),
    list: vi.fn(),
    archive: vi.fn(),
    reactivate: vi.fn(),
  };
  const onSaved = vi.fn().mockResolvedValue(undefined),
    onCancel = vi.fn(),
    onAccessRevoked = vi.fn();
  const props = {
    gateway,
    record: options.edit ? record : undefined,
    online: options.online ?? true,
    onSaved,
    onCancel,
    onAccessRevoked,
  };
  const view = render(<AircraftEditor {...props} />);
  return {
    ...view,
    props,
    create,
    update,
    onSaved,
    onCancel,
    onAccessRevoked,
    user: userEvent.setup(),
  };
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Registration mark'), ' demo-001 ');
  await user.type(screen.getByLabelText('Manufacturer'), ' Synthetic Manufacturer ');
  await user.type(screen.getByLabelText('Model'), ' Synthetic Model ');
}

describe('Aircraft editor foundation', () => {
  it('focuses the heading, labels all required fields and links empty-submit errors without a request', async () => {
    const { user, create } = setup();
    expect(screen.getByRole('heading', { name: 'Add aircraft' })).toHaveFocus();
    for (const name of ['Registration mark', 'Manufacturer', 'Model']) {
      expect(screen.getByLabelText(name)).toBeRequired();
      expect(screen.getByLabelText(name)).toHaveAccessibleDescription(/Required, up to/);
      expect(screen.getByLabelText(name)).not.toHaveAttribute('maxlength');
    }
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    expect(screen.getByRole('alert')).toHaveFocus();
    for (const name of ['registration mark', 'manufacturer', 'model']) {
      await user.click(screen.getByRole('link', { name: new RegExp(`Enter a valid ${name}`) }));
      const input = screen.getByRole('textbox', { name: new RegExp(name, 'i') });
      expect(input).toHaveFocus();
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription(/Enter a valid/);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('preserves Unicode code-point limits and does not silently truncate or impose registration formats', async () => {
    const { user, create } = setup();
    await fill(user);
    const model = screen.getByLabelText('Model');
    await user.clear(model);
    await user.paste('𐐀'.repeat(101));
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    expect(model).toHaveValue('𐐀'.repeat(101));
    expect(create).not.toHaveBeenCalled();
    await user.clear(model);
    await user.paste('𐐀'.repeat(100));
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ registrationMark: 'DEMO-001', model: '𐐀'.repeat(100) }),
    );
  });

  it('announces pending, prevents repeated clicks and preserves the existing create payload', async () => {
    let finish!: (value: typeof result) => void;
    const pending = new Promise<typeof result>((resolve) => {
      finish = resolve;
    });
    const { user, create, onSaved } = setup({ create: () => pending });
    await fill(user);
    const save = screen.getByRole('button', { name: 'Save record' });
    await user.dblClick(save);
    expect(create).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Saving aircraft record.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Model')).toBeDisabled();
    expect(create.mock.calls[0]?.[0]).toEqual({
      registrationMark: 'DEMO-001',
      manufacturer: 'Synthetic Manufacturer',
      model: 'Synthetic Model',
      idempotencyKey: expect.any(String) as string,
    });
    await act(async () => {
      finish(result);
      await pending;
    });
    expect(onSaved).toHaveBeenCalledWith(result);
  });

  it('keeps edit identity/version and user values through a conflict', async () => {
    const { user, update } = setup({ edit: true });
    update.mockRejectedValueOnce(
      new AircraftRegistryError('version_conflict', 'Review the latest record before saving.'),
    );
    await user.clear(screen.getByLabelText('Model'));
    await user.type(screen.getByLabelText('Model'), 'Attempted model');
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Review the latest record');
    expect(screen.getByLabelText('Model')).toHaveValue('Attempted model');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: record.id,
        expectedVersion: 4,
        model: 'Attempted model',
      }),
    );
  });

  it.each(['duplicate_registration', 'rate_limited', 'service_unavailable'] as const)(
    'preserves entries after %s and uses the existing retry policy',
    async (code) => {
      const { user, create } = setup();
      create.mockRejectedValueOnce(new AircraftRegistryError(code, 'Synthetic safe rejection.'));
      await fill(user);
      await user.click(screen.getByRole('button', { name: 'Save record' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic safe rejection.');
      expect(screen.getByLabelText('Model')).toHaveValue(' Synthetic Model ');
      await user.click(screen.getByRole('button', { name: 'Save record' }));
      const first = create.mock.calls[0]![0],
        second = create.mock.calls[1]![0];
      expect(second.idempotencyKey === first.idempotencyKey).toBe(
        code !== 'duplicate_registration',
      );
    },
  );

  it('disables offline saves, retains values on reconnect and keeps Cancel available', async () => {
    const { user, create, props, rerender, onCancel } = setup({ online: false });
    await fill(user);
    expect(screen.getByRole('button', { name: 'Save record' })).toBeDisabled();
    expect(screen.getByText(/Changes are not queued offline/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    rerender(<AircraftEditor {...props} online />);
    expect(screen.getByLabelText('Model')).toHaveValue(' Synthetic Model ');
    expect(screen.getByRole('button', { name: 'Save record' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it.each(['unauthenticated', 'mfa_required', 'unauthorized'] as const)(
    'delegates %s to the existing protected-access cleanup',
    async (code) => {
      const { user, create, onAccessRevoked, onSaved } = setup();
      create.mockRejectedValueOnce(new AircraftRegistryError(code, 'Access denied.'));
      await fill(user);
      await user.click(screen.getByRole('button', { name: 'Save record' }));
      await waitFor(() => expect(onAccessRevoked).toHaveBeenCalledOnce());
      expect(onSaved).not.toHaveBeenCalled();
      expect(screen.queryByText('Access denied.')).not.toBeInTheDocument();
    },
  );
});
