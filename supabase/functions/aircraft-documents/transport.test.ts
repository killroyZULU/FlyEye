import { describe, expect, it } from 'vitest';

import { streamedRequest } from '../../../src/test/request-stream';
import { MAX_AIRCRAFT_DOCUMENT_REQUEST_BYTES, readBody } from './transport';

describe('aircraft-document body transport compatibility', () => {
  it('preserves replacement decoding for invalid UTF-8', async () => {
    const fixture = streamedRequest([new Uint8Array([0xff])]);
    await expect(readBody(fixture.request)).resolves.toBe('�');
    expect(fixture.stream.locked).toBe(false);
  });

  it('retains declared oversize rejection without acquiring a reader', async () => {
    const fixture = streamedRequest([], {
      'content-length': String(MAX_AIRCRAFT_DOCUMENT_REQUEST_BYTES + 1),
    });
    await expect(readBody(fixture.request)).rejects.toThrow('request_too_large');
    expect(fixture.pull).not.toHaveBeenCalled();
    expect(fixture.stream.locked).toBe(false);
  });
});
