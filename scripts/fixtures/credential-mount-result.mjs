const categories = [
  'missing-session',
  'auth-4xx',
  'auth-5xx',
  'auth-unavailable',
  'bundle',
  'other',
];
export function mountFailure(error) {
  const message = String(error?.message ?? '');
  return (
    categories.find((label) => message.includes('[credential-mount:' + label + ']')) ?? 'other'
  );
}
