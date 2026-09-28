import { describe, expect, it } from 'vitest';

import { streamedRequest } from '../../../src/test/request-stream';
import { readBoundedRequestBody, RequestTooLargeError } from './request-body';

const encode = (text: string) => new TextEncoder().encode(text);

describe('bounded request-body reader', () => {
  it('returns empty text for an absent or empty body and releases the reader', async () => {
    await expect(readBoundedRequestBody(new Request('http://local'), 4)).resolves.toBe('');
    const fixture = streamedRequest([]);
    await expect(readBoundedRequestBody(fixture.request, 4)).resolves.toBe('');
    expect(fixture.stream.locked).toBe(false);
    expect(fixture.cancel).not.toHaveBeenCalled();
  });

  it('accepts the exact byte limit and decodes UTF-8 split across chunks', async () => {
    const bytes = encode('A€✈');
    const fixture = streamedRequest([bytes.slice(0, 2), bytes.slice(2, 5), bytes.slice(5)]);
    await expect(readBoundedRequestBody(fixture.request, bytes.length)).resolves.toBe('A€✈');
    expect(fixture.stream.locked).toBe(false);
    expect(fixture.cancel).not.toHaveBeenCalled();
  });

  it.each([undefined, '1', 'invalid', '-1'])(
    'enforces actual bytes with Content-Length %s and stops at the overflow chunk',
    async (declaredLength) => {
      const fixture = streamedRequest(
        [encode('1234'), encode('€'), encode('unread tail')],
        declaredLength === undefined ? {} : { 'content-length': declaredLength },
      );
      await expect(readBoundedRequestBody(fixture.request, 6)).rejects.toBeInstanceOf(
        RequestTooLargeError,
      );
      expect(fixture.pull).toHaveBeenCalledTimes(2);
      expect(fixture.cancel).toHaveBeenCalledOnce();
      expect(fixture.stream.locked).toBe(false);
    },
  );

  it('rejects a single oversized chunk without reading the tail', async () => {
    const fixture = streamedRequest([new Uint8Array(16_385), encode('tail')]);
    await expect(readBoundedRequestBody(fixture.request, 16_384)).rejects.toBeInstanceOf(
      RequestTooLargeError,
    );
    expect(fixture.pull).toHaveBeenCalledOnce();
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.stream.locked).toBe(false);
  });

  it.each([new Uint8Array([0xff]), new Uint8Array([0xe2, 0x82])])(
    'rejects malformed or incomplete UTF-8 in strict mode and unlocks',
    async (bytes) => {
      const fixture = streamedRequest([bytes]);
      await expect(readBoundedRequestBody(fixture.request, 8)).rejects.toBeInstanceOf(TypeError);
      expect(fixture.stream.locked).toBe(false);
    },
  );

  it('cancels on early decode failure without consuming later chunks', async () => {
    const fixture = streamedRequest([new Uint8Array([0xff]), encode('tail')]);
    await expect(readBoundedRequestBody(fixture.request, 8)).rejects.toBeInstanceOf(TypeError);
    expect(fixture.pull).toHaveBeenCalledOnce();
    expect(fixture.cancel).toHaveBeenCalledOnce();
  });

  it('preserves replacement decoding when selected by an endpoint', async () => {
    const fixture = streamedRequest([new Uint8Array([0xff, 0xe2, 0x82])]);
    await expect(readBoundedRequestBody(fixture.request, 3, { fatalUtf8: false })).resolves.toBe(
      '��',
    );
    expect(fixture.stream.locked).toBe(false);
  });

  it('propagates a source failure and releases its reader', async () => {
    const fixture = streamedRequest([]);
    const failure = new Error('Synthetic read failure');
    fixture.pull.mockImplementationOnce((controller) => controller.error(failure));
    await expect(readBoundedRequestBody(fixture.request, 8)).rejects.toBe(failure);
    expect(fixture.stream.locked).toBe(false);
  });

  it.each(['reject', 'pending'] as const)(
    'preserves prompt overflow rejection when cancellation is %s',
    async (behavior) => {
      const fixture = streamedRequest([encode('12345')]);
      fixture.cancel.mockImplementationOnce(() =>
        behavior === 'reject'
          ? Promise.reject(new Error('Synthetic cancellation failure'))
          : new Promise<void>(() => undefined),
      );
      await expect(readBoundedRequestBody(fixture.request, 4)).rejects.toBeInstanceOf(
        RequestTooLargeError,
      );
      expect(fixture.cancel).toHaveBeenCalledOnce();
      expect(fixture.stream.locked).toBe(false);
    },
  );
});
