/**
 * Desktop Blink WebGPU: compute atomics + drawIndirect.
 * Apple WebKit (iPhone/iPad/MacBook) and the WebGL2 fallback: CPU compact + Mesh.count.
 */
export function useCpuCull(gl) {
  if (!gl?.backend?.isWebGPUBackend) return true;
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const platform = navigator.userAgentData?.platform ?? navigator.platform;
  const isAppleMobile = /iPhone|iPad|iPod/.test(ua)
    || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMac = platform === 'MacIntel'
    || platform === 'macOS'
    || /Macintosh|Mac OS X/.test(ua);
  return isAppleMobile || isMac;
}
