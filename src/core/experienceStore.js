import {
  EXPLORE_PROFILE,
  getInitialCameraMode,
} from '../components/camera/cameraModes';
import { tweenThemeTo } from '../components/scene/themeTween';
import { isDebugRoute } from './debugRoute';
import { create } from 'zustand';

export const TIER1_TARGETS = ['character', 'backpack'];

export const useExperienceStore = create((set) => ({
  isStarted: isDebugRoute(),
  setStarted: (isStarted) => set({ isStarted }),

  isSoundOn: false,
  setIsSoundOn: (isSoundOn) => set({ isSoundOn }),

  theme: 'light',
  setTheme: (theme) =>
    set((state) => {
      if (state.theme === theme) return state;
      document.documentElement.dataset.theme = theme;
      tweenThemeTo(theme);
      return { theme };
    }),

  audioListener: null,
  setAudioListener: (audioListener) => set({ audioListener }),

  gpuError: null,
  setGpuError: (gpuError) =>
    set((state) => (state.gpuError === gpuError ? state : { gpuError })),

  readyStatus: {},
  setComponentReady: (id, isReady) =>
    set((state) => {
      if (state.readyStatus[id] === isReady) return state;
      return { readyStatus: { ...state.readyStatus, [id]: isReady } };
    }),

  cameraMode: getInitialCameraMode(),
  setCameraMode: (cameraMode) =>
    set((state) => (state.cameraMode === cameraMode ? state : { cameraMode })),
  exploreProfile: EXPLORE_PROFILE.Developer,
  setExploreProfile: (exploreProfile) =>
    set((state) =>
      state.exploreProfile === exploreProfile ? state : { exploreProfile },
    ),

  // 0 = active looking, 1 = sustained stillness. For environmental systems.
  stillness: 0,
  setStillness: (stillness) =>
    set((state) =>
      Math.abs(state.stillness - stillness) < 0.002 ? state : { stillness },
    ),

  // Authored plant-time multiplier shared by FLOW, EXPLORE, and the TIME rail.
  plantTimeScale: 1,
  setPlantTimeScale: (plantTimeScale) =>
    set((state) =>
      Math.abs(state.plantTimeScale - plantTimeScale) < 0.03
        ? state
        : { plantTimeScale },
    ),
  plantTimeTarget: 1,
  setPlantTimeTarget: (plantTimeTarget) =>
    set((state) =>
      Math.abs(state.plantTimeTarget - plantTimeTarget) < 0.002
        ? state
        : { plantTimeTarget },
    ),
  isTimeScrubbing: false,
  setTimeScrubbing: (isTimeScrubbing) =>
    set((state) =>
      state.isTimeScrubbing === isTimeScrubbing
        ? state
        : { isTimeScrubbing },
    ),

  // False until FLOW camera intro hands off to the live orbit.
  flowIntroDone: false,
  setFlowIntroDone: (flowIntroDone) =>
    set((state) =>
      state.flowIntroDone === flowIntroDone ? state : { flowIntroDone },
    ),
}));
