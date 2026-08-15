import { create } from 'zustand';
import { isDebugRoute } from './debugRoute';

export const TIER1_TARGETS = ['character', 'backpack'];

export const useExperienceStore = create((set, get) => ({
  isStarted: isDebugRoute(),
  setStarted: (isStarted) => set({ isStarted }),

  gpuError: null,
  setGpuError: (gpuError) =>
    set((state) => (state.gpuError === gpuError ? state : { gpuError })),

  isMobile: false,
  setIsMobile: (isMobile) =>
    set((state) => (state.isMobile === isMobile ? state : { isMobile })),

  tier1Targets: TIER1_TARGETS,
  setTier1Targets: (tier1Targets) => set({ tier1Targets }),

  readyStatus: {},
  setComponentReady: (id, isReady) =>
    set((state) => {
      if (state.readyStatus[id] === isReady) return state;
      return { readyStatus: { ...state.readyStatus, [id]: isReady } };
    }),

  areTier1TargetsReady: () => {
    const { tier1Targets, readyStatus } = get();
    if (tier1Targets.length === 0) return false;
    return tier1Targets.every((id) => readyStatus[id] === true);
  },
}));
