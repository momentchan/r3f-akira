import { getInitialCameraMode } from '../components/camera/cameraModes';
import { isDebugRoute } from './debugRoute';
import { create } from 'zustand';

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

  cameraMode: getInitialCameraMode(),
  setCameraMode: (cameraMode) =>
    set((state) => (state.cameraMode === cameraMode ? state : { cameraMode })),

  // 0 = active looking, 1 = sustained stillness. For environmental systems.
  stillness: 0,
  setStillness: (stillness) =>
    set((state) =>
      Math.abs(state.stillness - stillness) < 0.002 ? state : { stillness },
    ),

  // Authored plant-time multiplier (FLOW pointer Y, EXPLORE stillness).
  plantTimeScale: 1,
  setPlantTimeScale: (plantTimeScale) =>
    set((state) =>
      Math.abs(state.plantTimeScale - plantTimeScale) < 0.03
        ? state
        : { plantTimeScale },
    ),

  // False until FLOW camera intro hands off to the live orbit.
  flowIntroDone: false,
  setFlowIntroDone: (flowIntroDone) =>
    set((state) =>
      state.flowIntroDone === flowIntroDone ? state : { flowIntroDone },
    ),
}));
