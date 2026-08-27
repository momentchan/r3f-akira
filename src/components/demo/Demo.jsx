import { Demo1WoodblockToon } from './Demo1WoodblockToon';

// Switch manually when capturing article sections.
// 1 — Woodblock Toon (quantized light + hull outline)
const ACTIVE_DEMO = 1;

const DEMOS = {
  1: Demo1WoodblockToon,
};

export function Demo() {
  const ActiveDemo = DEMOS[ACTIVE_DEMO];
  if (!ActiveDemo) return null;
  return <ActiveDemo />;
}
