import { useEffect } from 'react';
import { LoopRepeat, type AnimationAction } from 'three';

/** Special pose: leave the skeleton at the GLB bind pose (no clips). */
export const BIND_POSE = 'Bind';

/**
 * Still-scene pose control.
 * - `Bind`: stop every clip → initial / bind pose
 * - clip names (Lay, Fetal, Drift, …): play that clip alone
 */
export function useCharacterTableau(
  actions: Record<string, AnimationAction | null | undefined> | null | undefined,
  names: string[],
  pose: string,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || !actions) return;

    const useBind = pose === BIND_POSE || !pose;
    const available =
      !useBind && names.includes(pose) ? pose : null;

    for (const name of names) {
      const action = actions[name];
      if (!action) continue;
      if (available && name === available) {
        action.reset().play();
        action.setEffectiveWeight(1);
        // Hold pose clips (Lay/Fetal are short) without flickering
        action.setLoop(LoopRepeat, Infinity);
        action.clampWhenFinished = true;
      } else {
        action.stop();
        action.setEffectiveWeight(0);
      }
    }
  }, [actions, names, pose, enabled]);
}
