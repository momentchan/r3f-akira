const FLOWER_CULL_BACKEND_OVERRIDE = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('backend')
  : null;

/**
 * Use CPU compaction on backends where indirect LOD submission is unreliable.
 * WebGL2 always uses the CPU path; Apple devices use it for WebGPU as well.
 *
 * `flowerCullBackend=cpu|gpu` is a temporary A/B switch for diagnosing backend
 * differences without changing the scene or the flower data.
 */
export function useCpuCull(gl) {
  if (!gl?.backend?.isWebGPUBackend) return true;
  if (FLOWER_CULL_BACKEND_OVERRIDE === 'cpu') return true;
  if (FLOWER_CULL_BACKEND_OVERRIDE === 'gpu') return false;
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  const platform = navigator.userAgentData?.platform ?? navigator.platform;
  return platform === 'MacIntel'
    || platform === 'macOS'
    || /Macintosh|Mac OS X/.test(ua);
}
