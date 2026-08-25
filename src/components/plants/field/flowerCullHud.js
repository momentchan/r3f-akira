import { isDebugRoute } from '../../../core/debugRoute';
import { FLOWER_LOD_DEBUG_COLORS } from '../vat/flowerCullDefaults';
import {
  countActiveFlowerHeads,
  countTotalFlowerSlots,
  readDrawnFlowerCounts,
} from '../vat/flowerInstanceCull';

function rgbCss([r, g, b]) {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export function mountFlowerCullHud(showLegend) {
  const showStats = isDebugRoute();
  if (!showStats && !showLegend) return null;

  const root = document.createElement('div');
  root.className = 'flower-cull-hud';

  let totalEl = null;
  let activeEl = null;
  let drawnEl = null;
  let dprEl = null;
  let fpsEl = null;
  if (showStats) {
    totalEl = document.createElement('span');
    activeEl = document.createElement('span');
    drawnEl = document.createElement('span');
    dprEl = document.createElement('span');
    fpsEl = document.createElement('span');
    totalEl.textContent = 'total 0';
    activeEl.textContent = 'active 0';
    drawnEl.textContent = 'drawn 0';
    dprEl.textContent = 'dpr —';
    fpsEl.textContent = 'fps —';
    root.append(totalEl, activeEl, drawnEl, dprEl, fpsEl);
  }

  if (showLegend) {
    const legendEl = document.createElement('div');
    legendEl.className = 'flower-cull-lod-legend';
    for (const [label, color] of [
      ['LOD0 hi-poly', FLOWER_LOD_DEBUG_COLORS.hi],
      ['LOD1 low-poly', FLOWER_LOD_DEBUG_COLORS.lo],
    ]) {
      const row = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = rgbCss(color);
      row.append(swatch, document.createTextNode(label));
      legendEl.append(row);
    }
    root.append(legendEl);
  }

  document.body.appendChild(root);
  return { root, totalEl, activeEl, drawnEl, dprEl, fpsEl };
}

export function unmountFlowerCullHud(hud) {
  hud?.root?.remove();
}

export function tickFlowerCullFps(hud, gl, fps) {
  if (hud?.fpsEl) hud.fpsEl.textContent = `fps ${fps.toFixed(1)}`;
  if (hud?.dprEl) hud.dprEl.textContent = `dpr ${gl.getPixelRatio().toFixed(2)}`;
}

export function pollFlowerCullCounts(hud, gl, flowerBatches, rt, elapsed) {
  if (!isDebugRoute() || rt.cullReadPending || elapsed - rt.cullReadAt <= 0.25) return;
  rt.cullReadPending = true;
  rt.cullReadAt = elapsed;
  const total = countTotalFlowerSlots(flowerBatches);
  const active = countActiveFlowerHeads(flowerBatches);
  readDrawnFlowerCounts(gl, flowerBatches).then((perLod) => {
    rt.cullReadPending = false;
    if (!hud?.totalEl) return;
    const drawn = perLod.reduce((sum, n) => sum + n, 0);
    hud.totalEl.textContent = `total ${total}`;
    hud.activeEl.textContent = `active ${active}`;
    hud.drawnEl.textContent = `drawn ${drawn} [${perLod.join('/')}]`;
    if (hud.dprEl) hud.dprEl.textContent = `dpr ${gl.getPixelRatio().toFixed(2)}`;
  }).catch(() => {
    rt.cullReadPending = false;
  });
}
