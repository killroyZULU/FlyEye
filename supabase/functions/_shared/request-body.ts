export class RequestTooLargeError extends Error {}

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
  options: { fatalUtf8?: boolean } = {},
): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';

  const decoder = new TextDecoder('utf-8', { fatal: options.fatalUtf8 ?? true });
  let bytesRead = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) throw new RequestTooLargeError();
      body += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    // Cancellation is best effort: a failing or stalled source must not delay rejection.
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
