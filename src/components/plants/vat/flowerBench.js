/** Label + window sample for the CPU vs vertex A/B bench. */
export function getFlowerBenchLabel(flags = {}) {
  const parts = [];
  if (flags.forceAllLow) parts.push('forceLow');
  if (flags.freezeTips) parts.push('freezeTips');
  if (flags.noFlowerShadows || flags.flowerCastShadows === false) parts.push('noFlowerShadows');
  if (flags.lowShadowCasters) parts.push('lowShadowCasters');
  if (flags.hideStems) parts.push('hideStems');
  if (flags.hideLeaves) parts.push('hideLeaves');
  if (flags.freezeMigrate) parts.push('freezeMigrate');
  return parts.length ? parts.join('+') : 'baseline';
}

export function publishFlowerBench(sample) {
  if (typeof window === 'undefined') return;
  window.__AKIRA_BENCH__ = sample;
}
