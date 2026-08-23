import { useEffect, useMemo, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { TIER1_TARGETS, useExperienceStore } from './experienceStore';

const MIN_INTRO_MS = 1000;

/**
 * Experience-level readiness. Download vs GPU compile stay inside this hook;
 * the UI only sees phase / progress / isReady / error.
 */
export function useExperienceReady() {
  const { active, progress: downloadProgress } = useProgress();
  const gpuError = useExperienceStore((state) => state.gpuError);
  const readyStatus = useExperienceStore((state) => state.readyStatus);
  const tier1Targets = TIER1_TARGETS;

  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_INTRO_MS);
    return () => clearTimeout(t);
  }, []);

  const total = tier1Targets.length;
  const loadedCount = tier1Targets.filter((id) => readyStatus[id]).length;
  const compileProgress = total === 0 ? 0 : (loadedCount / total) * 100;
  const targetsReady = total > 0 && loadedCount === total;

  const progress = useMemo(() => {
    if (active) return Math.round(downloadProgress * 0.5);
    return Math.min(Math.round(50 + compileProgress * 0.5), 99);
  }, [active, downloadProgress, compileProgress]);

  // Tier 1 AsyncCompile only mounts after character/backpack suspense resolves.
  const isExperienceReady = Boolean(!gpuError && targetsReady && minElapsed);

  let phase = 'loading';
  if (gpuError) phase = 'error';
  else if (isExperienceReady) phase = 'ready';

  return {
    status: {
      phase,
      progress: isExperienceReady ? 100 : progress,
      isReady: isExperienceReady,
      error: gpuError,
    },
  };
}
