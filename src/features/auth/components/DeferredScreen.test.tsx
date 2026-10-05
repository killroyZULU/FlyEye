import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lazy, type ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DeferredScreen } from './DeferredScreen';

function deferredComponent() {
  let resolve!: (module: { default: ComponentType }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ default: ComponentType }>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  const load = vi.fn(() => promise);
  return { Screen: lazy(load), load, resolve, reject, promise };
}

describe('deferred screen boundary', () => {
  it('keeps an exit action available while loading and replaces the fallback on success', async () => {
    const pending = deferredComponent();
    const leave = vi.fn();
    render(
      <DeferredScreen onLeave={leave} leaveLabel="Sign out">
        <pending.Screen />
      </DeferredScreen>,
    );
    expect(screen.getByRole('heading', { name: 'Loading this screen' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(leave).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve({ default: () => <h2>Loaded screen</h2> });
      await pending.promise;
    });
    expect(screen.getByRole('heading', { name: 'Loaded screen' })).toBeVisible();
    expect(screen.queryByText('Loading this screen')).not.toBeInTheDocument();
    expect(pending.load).toHaveBeenCalledOnce();
  });

  it('contains rejected imports without raw diagnostics or automatic retries', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const pending = deferredComponent();
      const leave = vi.fn();
      render(
        <DeferredScreen onLeave={leave}>
          <pending.Screen />
        </DeferredScreen>,
      );
      await act(async () => {
        pending.reject(new Error('private diagnostic'));
        await pending.promise.catch(() => undefined);
      });
      expect(screen.getByRole('heading', { name: 'This screen could not load' })).toBeVisible();
      expect(screen.queryByText(/private diagnostic/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload page' })).toBeEnabled();
      await userEvent.click(screen.getByRole('button', { name: 'Back to workspace' }));
      expect(leave).toHaveBeenCalledOnce();
      expect(pending.load).toHaveBeenCalledOnce();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('does not mount a pending screen after its boundary is removed', async () => {
    const pending = deferredComponent();
    const screenRender = vi.fn(() => <h2>Obsolete screen</h2>);
    const { unmount } = render(
      <DeferredScreen>
        <pending.Screen />
      </DeferredScreen>,
    );
    unmount();
    await act(async () => {
      pending.resolve({ default: screenRender });
      await pending.promise;
    });
    expect(screenRender).not.toHaveBeenCalled();
  });

  it('allows another keyed screen after failure', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const pending = deferredComponent();
      const { rerender } = render(
        <DeferredScreen key="profile">
          <pending.Screen />
        </DeferredScreen>,
      );
      await act(async () => {
        pending.reject(new Error('load failed'));
        await pending.promise.catch(() => undefined);
      });
      rerender(
        <DeferredScreen key="home">
          <h2>Home screen</h2>
        </DeferredScreen>,
      );
      expect(screen.getByRole('heading', { name: 'Home screen' })).toBeVisible();
      expect(screen.queryByText('This screen could not load')).not.toBeInTheDocument();
    } finally {
      errorLog.mockRestore();
    }
  });
});
