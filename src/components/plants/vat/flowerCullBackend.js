/**
 * Desktop Blink WebGPU: compute atomics + drawIndirect.
 * Apple WebKit (iPhone Chrome) and the WebGL2 fallback: CPU compact + Mesh.count.
 */
export function useCpuCull(gl) {
  if (!gl?.backend?.isWebGPUBackend) return true;
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
