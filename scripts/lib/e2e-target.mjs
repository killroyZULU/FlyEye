export function loopbackTarget(port = '4173') {
  if (!/^[1-9]\d{3,4}$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
    throw new Error('Expected an unprivileged numeric E2E port.');
  return { port, origin: 'http://127.0.0.1:' + port };
}

export const { origin: browserOrigin, port: browserPort } = loopbackTarget(
  process.env.FLYEYE_E2E_PORT,
);
