import {
  pickClumpHeart,
  sampleClumpHop,
  sampleFieldPosition,
} from './fieldClusterLayout';

/** Sim-seconds between heart hops. Default migrateSpeed 0.035 → 10s. */
export function heartPeriod(migrateSpeed) {
  return 0.35 / Math.max(migrateSpeed, 0.001);
}

function hopSample(migration, fieldOptions, seed, tick) {
  return {
    anchors: migration.anchors,
    fieldOptions,
    clearanceHosts: migration.clearanceHosts,
    clearMargin: migration.meshClearDistance,
    seed,
    tick,
  };
}

/** Advance hearts that are due this simTime. migrateRange 0 is a no-op. */
export function hopHearts(hearts, migration, fieldOptions, simTime) {
  const range = migration.migrateRange ?? 0;
  const speed = migration.migrateSpeed ?? 0;
  if (range <= 0 || speed <= 0 || !hearts.length) return;

  const period = heartPeriod(speed);
  for (let h = 0; h < hearts.length; h += 1) {
    const heart = hearts[h];
    const phase = (heart.id * 0.728) % 1;
    const beat = Math.floor(simTime / period - phase);
    if (heart.beat < 0) {
      heart.beat = beat;
      continue;
    }
    if (beat === heart.beat) continue;
    heart.beat = beat;
    const sample = hopSample(migration, fieldOptions, heart.id * 17 + 1, heart.relocateTick);
    const crept = sampleClumpHop({
      ...sample,
      from: { x: heart.cx, z: heart.cz },
      hopMin: range * 0.25,
      hopMax: range,
    });
    const next = crept ?? sampleFieldPosition({
      ...sample,
      anchorIndex: heart.anchorIndex,
    });
    if (next) {
      heart.cx = next.x;
      heart.cz = next.z;
    }
    heart.relocateTick += 1;
  }
}

/** Same rule as layout: pick a heart on this pin, hop hopRange. */
export function respawnPlant(plant, hearts, migration, fieldOptions) {
  if (!hearts.length) return;
  const [bx, bz] = migration.bodyCenter ?? [0, 0];
  const hopMin = migration.hopMin ?? 0.07;
  const hopMax = migration.hopMax ?? 0.2;
  const sample = hopSample(migration, fieldOptions, plant.seed, plant.respawnTick);
  const heart = pickClumpHeart({
    hearts,
    x: plant.position[0],
    z: plant.position[2],
    anchors: migration.anchors,
    fieldOptions,
    attractRadius: hopMax * 3,
    seed: plant.seed,
    tick: plant.respawnTick,
    anchorIndex: plant.anchorIndex ?? -1,
  });
  if (!heart) return;
  const got = sampleClumpHop({
    ...sample,
    from: { x: heart.cx, z: heart.cz },
    hopMin,
    hopMax,
  });
  if (got) {
    plant.position[0] = got.x;
    plant.position[2] = got.z;
    plant.yaw = Math.atan2(got.x - bx, got.z - bz) - plant.baseLeanAngle;
    plant.clumpId = heart.id;
    plant.anchorIndex = heart.anchorIndex;
  }
  plant.respawnTick += 1;
}
