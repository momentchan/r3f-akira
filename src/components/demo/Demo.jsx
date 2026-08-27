import { Demo1WoodblockToon } from './Demo1WoodblockToon';
import { Demo2StylishShadow } from './Demo2StylishShadow';

// Switch manually when capturing article sections.
// 1 — Woodblock Toon (quantized light + hull outline)
// 2 — Stylish Ground Shadow (single dahlia on ShadowCatcher)
const ACTIVE_DEMO = 2;

const DEMOS = {
  1: Demo1WoodblockToon,
  2: Demo2StylishShadow,
};

export function Demo() {
  const ActiveDemo = DEMOS[ACTIVE_DEMO];
  if (!ActiveDemo) return null;
  return <ActiveDemo />;
}
