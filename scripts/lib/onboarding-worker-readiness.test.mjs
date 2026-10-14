import { describe, expect, it, vi } from 'vitest';
import { createAdminOnboardingHandler } from '../../supabase/functions/organization-admin-onboarding/handler.ts';
import { waitForOnboardingWorker } from './onboarding-worker-readiness.mjs';

const origin = 'https://current-synthetic.invalid';
const oldOrigin = 'https://older-synthetic.invalid';
const expected = {
  error: { code: 'admin_onboarding.method_not_allowed', message: 'This request is not supported.' },
};
const url = 'http://127.0.0.1:1/functions/v1/organization-admin-onboarding';
function fixture() {
  const authenticate = vi.fn(() => {
    throw new Error('Protected authentication must not run');
  });
  const handler = createAdminOnboardingHandler({ allowedOrigin: origin, authenticate });
  const fetchRequest = vi.fn((input, init) => handler(new Request(input, init)));
  return {
    url,
    origin,
    apiKey: 'synthetic-public',
    token: 'synthetic-token',
    fetchRequest,
    isAlive: () => true,
    delay: vi.fn(async () => {}),
    authenticate,
  };
}

describe('current onboarding worker readiness', () => {
  it('rejects the real old-origin handler response that previously satisfied readiness', async () => {
    const context = fixture();
    const oldHandler = createAdminOnboardingHandler({
      allowedOrigin: oldOrigin,
      authenticate: context.authenticate,
    });
    const oldResponse = await oldHandler(new Request(url, { method: 'GET', headers: { origin } }));
    expect(oldResponse.status).toBe(403);
    // The former status-only predicate incorrectly accepted this response.
    expect([400, 401, 403, 405, 422].includes(oldResponse.status)).toBe(true);
    context.fetchRequest.mockResolvedValueOnce(oldResponse);
    await waitForOnboardingWorker(context);
    expect(context.fetchRequest).toHaveBeenCalledTimes(2);
    expect(context.delay).toHaveBeenCalledOnce();
    expect(context.authenticate).not.toHaveBeenCalled();
    for (const [input, init, timeout] of context.fetchRequest.mock.calls) {
      expect(input).toBe(url);
      expect(init).toEqual({
        method: 'GET',
        headers: { apikey: context.apiKey, authorization: `Bearer ${context.token}`, origin },
      });
      expect(timeout).toBe(2000);
    }
  });
  it.each([
    [401, { msg: 'gateway rejection' }, origin],
    [405, expected, oldOrigin],
    [405, { error: { code: 'unrelated' } }, origin],
    [405, { ...expected, unexpected: true }, origin],
    [502, { message: 'gateway error' }, origin],
  ])(
    'does not accept unrelated status/body/origin: %i %j %s',
    async (status, payload, responseOrigin) => {
      const context = fixture();
      context.fetchRequest.mockResolvedValueOnce(
        Response.json(payload, {
          status,
          headers: { 'access-control-allow-origin': responseOrigin },
        }),
      );
      await waitForOnboardingWorker(context);
      expect(context.fetchRequest).toHaveBeenCalledTimes(2);
      expect(context.authenticate).not.toHaveBeenCalled();
    },
  );
  it('bounds transport and decoding failures without disclosing their payloads', async () => {
    const context = fixture();
    context.fetchRequest
      .mockRejectedValueOnce(new Error('private-provider-token'))
      .mockImplementation(async () => new Response('private-provider-payload', { status: 502 }));
    await expect(waitForOnboardingWorker(context)).rejects.toThrow(
      'Local Edge Runtime did not become ready.',
    );
    expect(context.fetchRequest).toHaveBeenCalledTimes(80);
    expect(context.delay).toHaveBeenCalledTimes(79);
  });
  it('stops immediately when the owned worker process exits', async () => {
    const context = fixture();
    context.isAlive = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    context.fetchRequest.mockRejectedValueOnce(new Error('private'));
    await expect(waitForOnboardingWorker(context)).rejects.toThrow(
      'Local Edge Runtime stopped before readiness.',
    );
    expect(context.fetchRequest).toHaveBeenCalledTimes(1);
  });
});
