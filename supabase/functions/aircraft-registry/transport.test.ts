import { describe, expect, it } from 'vitest';

import { streamedRequest } from '../../../src/test/request-stream';
import {
  AircraftRequestTooLargeError,
  MAX_AIRCRAFT_REQUEST_BYTES,
  readAircraftBody,
} from './transport';

describe('aircraft-registry body transport compatibility', () => {
  it('preserves replacement decoding for invalid UTF-8', async () => {
    const fixture = streamedRequest([new Uint8Array([0xff])]);
    await expect(readAircraftBody(fixture.request)).resolves.toBe('�');
    expect(fixture.stream.locked).toBe(false);
  });

  it('retains declared oversize rejection without acquiring a reader', async () => {
    const fixture = streamedRequest([], {
      'content-length': String(MAX_AIRCRAFT_REQUEST_BYTES + 1),
    });
    await expect(readAircraftBody(fixture.request)).rejects.toBeInstanceOf(
      AircraftRequestTooLargeError,
    );
    expect(fixture.pull).not.toHaveBeenCalled();
    expect(fixture.stream.locked).toBe(false);
  });
});
