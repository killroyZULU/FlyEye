import { parentPort } from 'node:worker_threads';
import { localJson } from './no-send-runtime-client.mjs';

parentPort.on('message', async ({ url, options }) => {
  try {
    const result = await localJson(url, options, (...arguments_) => {
      parentPort.postMessage({ type: 'observation', arguments: arguments_ });
    });
    parentPort.postMessage({ type: 'result', result });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error,
      errorName: error?.name,
      errorMessage: error?.message,
      code: error?.code,
      causeCode: error?.cause?.code,
    });
  }
});
