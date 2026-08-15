/** True when the last path segment is `debug` (e.g. `/debug` or `/repo/debug`). */
export function isDebugRoute() {
  if (typeof window === 'undefined') return false;
  const segments = window.location.pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] === 'debug';
}
