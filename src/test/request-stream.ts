import { vi } from 'vitest';

export function streamedRequest(chunks: Uint8Array[], headers: HeadersInit = {}) {
  let index = 0;
  const cancel = vi.fn<() => void | Promise<void>>();
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    const chunk = chunks[index++];
    if (chunk) controller.enqueue(chunk);
    else controller.close();
  });
  const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  };
  return { request: new Request('http://local/stream-test', init), stream, pull, cancel };
}
