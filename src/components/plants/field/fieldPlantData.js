import * as THREE from 'three/webgpu';

/**
 * Per-plant data, one texel column per plant:
 *   row 0 = [stemGrow, swayX, swayZ, _]
 *   row 1 = [offsetX, offsetY, offsetZ, yaw]
 * Row 1 lets a plant move + turn on respawn without remeshing tubes.
 */
const PLANT_DATA_ROWS = 2;

export function heartsFromLayout(hearts) {
  if (!hearts?.length) return [];
  const list = [];
  for (let i = 0; i < hearts.length; i += 1) {
    const h = hearts[i];
    list.push({
      id: h.id,
      anchorIndex: h.anchorIndex ?? 0,
      cx: h.cx,
      cz: h.cz,
      beat: -1,
      relocateTick: 0,
    });
  }
  return list;
}

export function createPlantDataTexture(count, rows = PLANT_DATA_ROWS) {
  const width = Math.max(1, THREE.MathUtils.ceilPowerOfTwo(count));
  const data = new Float32Array(width * rows * 4);
  const tex = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, data, width, rows };
}

function stemTubeKey(stem) {
  const p = stem.params;
  return `${stem.seed}:${stem.flowerType?.id}`
    + `:${p.stemLength}:${p.stemRadius}:${p.leanAngle}:${p.bendDegree}`
    + `:${p.radiusAttenuation}:${p.baseFlare}`
    + `:${stem.leanOutwardAngle ?? 0}`;
}

export function stemsTubeKey(stems) {
  let key = String(stems.length);
  for (let i = 0; i < stems.length; i += 1) key += `|${stemTubeKey(stems[i])}`;
  return key;
}

function writePlacementRow(data, width, plants) {
  for (let i = 0; i < plants.length; i += 1) {
    const plant = plants[i];
    const o1 = (width + i) * 4;
    data[o1] = plant.position[0];
    data[o1 + 1] = plant.position[1];
    data[o1 + 2] = plant.position[2];
    data[o1 + 3] = plant.yaw;
  }
}

export function writePlantPlacement(plantData, plants) {
  if (!plantData || !plants.length) return;
  writePlacementRow(plantData.data, plantData.width, plants);
  plantData.tex.needsUpdate = true;
}

/** Growth + sway (row 0) and placement (row 1) for the current frame. */
export function writePlantState(plantData, plants) {
  if (!plantData || !plants.length) return;
  const { data, width, tex } = plantData;
  for (let i = 0; i < plants.length; i += 1) {
    const plant = plants[i];
    const o = i * 4;
    data[o] = plant.stemGrow;
    data[o + 1] = plant.swayX;
    data[o + 2] = plant.swayZ;
    data[o + 3] = 0;
  }
  writePlacementRow(data, width, plants);
  tex.needsUpdate = true;
}

/** Move existing plants onto a new layout without rebuilding merged tubes. */
export function applyStemLayout(rt, stems, hearts) {
  const plants = rt.plants;
  if (!plants.length || plants.length !== stems.length) return false;
  for (let i = 0; i < plants.length; i += 1) {
    if (plants[i].seed !== stems[i].seed) return false;
  }
  for (let i = 0; i < plants.length; i += 1) {
    const stem = stems[i];
    const plant = plants[i];
    plant.position[0] = stem.position[0];
    plant.position[1] = stem.position[1];
    plant.position[2] = stem.position[2];
    plant.yaw = (stem.leanOutwardAngle ?? 0) - plant.baseLeanAngle;
    plant.anchorIndex = stem.anchorIndex;
    plant.clumpId = stem.clumpId ?? plant.clumpId;
    plant.bloomCeiling = stem.bloomCeiling ?? 1;
    plant.slotIndex = stem.slotIndex ?? plant.slotIndex;
  }
  writePlantPlacement(rt.plantData, plants);
  rt.hearts = heartsFromLayout(hearts);
  return true;
}
