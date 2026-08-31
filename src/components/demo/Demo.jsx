import { Demo1WoodblockToon } from './Demo1WoodblockToon';
import { Demo2StylishShadow } from './Demo2StylishShadow';
import { Demo3StemShape } from './Demo3StemShape';
import { Demo4FlowerShed } from './Demo4FlowerShed';
import { Demo5TendrilRoute } from './Demo5TendrilRoute';

// Switch manually when capturing article sections.
// 0 — full chapter (FLOW camera)
// 1 — Woodblock Toon
// 2 — Stylish Ground Shadow
// 3 — Stem curve / taper / lifecycle
// 4 — Flower bloom → petal scatter
// 5 — One wrap station → one routed tendril
// Frame with drag-orbit. Lock later via LOCK_DEMO_CAMERA in demoCamera.js.
export const ACTIVE_DEMO = 2;

const DEMOS = {
  1: Demo1WoodblockToon,
  2: Demo2StylishShadow,
  3: Demo3StemShape,
  4: Demo4FlowerShed,
  5: Demo5TendrilRoute,
};

export function Demo() {
  const ActiveDemo = DEMOS[ACTIVE_DEMO];
  if (!ActiveDemo) return null;
  return <ActiveDemo />;
}
