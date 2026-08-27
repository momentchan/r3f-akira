import { useLayoutEffect, useMemo, useRef } from 'react';
import { folder, useControls } from 'leva';
import * as THREE from 'three/webgpu';
import { CHARACTER_LOOK_DEFAULTS } from '../character/look/characterDefaults';
import { attachOutline } from '../character/look/createLookMaterial';
import { createOutlineMaterial } from '../character/materials/createToonNodeMaterial';
import {
  createFlowerMaskUniforms,
  createFlowerUniforms,
  createFlowerVertexColorMaterial,
} from '../plants/look/createFlowerMaterials';
import { FLOWER_DEFAULTS } from '../plants/look/flowerDefaults';

const SPHERE_RADIUS = 0.7;
const petal = FLOWER_DEFAULTS.petal;

function createFlowerSphereGeometry(radius) {
  const geometry = new THREE.SphereGeometry(radius, 64, 48);
  const count = geometry.getAttribute('position').count;
  const color = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    color[i * 3] = 1;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return geometry;
}

/** Codrops Still — Woodblock Toon (quantized light + inverted-hull outline). */
export function Demo1WoodblockToon() {
  const look = useControls('Demo / Woodblock Toon', {
    Petal: folder({
      albedo: { value: petal.baseColor, label: 'albedo' },
      colorLevels: { value: petal.colorLevels, min: 2, max: 30, step: 1 },
      thresholdLow: { value: petal.thresholdLow, min: 0, max: 1, step: 0.01 },
      thresholdHigh: { value: petal.thresholdHigh, min: 0, max: 1, step: 0.01 },
      thresholdNoiseScale: { value: petal.thresholdNoiseScale, min: 0.1, max: 240, step: 0.1 },
      thresholdNoiseStrength: {
        value: petal.thresholdNoiseStrength,
        min: 0,
        max: 0.35,
        step: 0.005,
      },
      shadowTint: { value: petal.shadowTint },
      highlightTint: { value: petal.highlightTint },
      saturation: { value: petal.saturation ?? 1, min: 0, max: 2, step: 0.01 },
    }),
    Outline: folder({
      edgeColor: { value: CHARACTER_LOOK_DEFAULTS.edgeColor },
      outlineWidth: {
        value: 0.02,
        min: 0,
        max: 0.08,
        step: 0.001,
        label: 'contour width',
      },
    }),
  });

  const flowerUniforms = useMemo(() => createFlowerUniforms(), []);
  const maskUniforms = useMemo(() => createFlowerMaskUniforms(), []);
  const geometry = useMemo(() => createFlowerSphereGeometry(SPHERE_RADIUS), []);

  const petalMat = useMemo(
    () =>
      createFlowerVertexColorMaterial(
        flowerUniforms,
        maskUniforms,
        null,
        null,
        { usePetalCutout: false, useMaskEdge: false, useVeins: false },
      ),
    [flowerUniforms, maskUniforms],
  );
  const outlineMat = useMemo(
    () =>
      createOutlineMaterial({
        edgeColor: CHARACTER_LOOK_DEFAULTS.edgeColor,
        outlineWidth: 0.02,
      }),
    [],
  );

  useLayoutEffect(
    () => () => {
      petalMat.dispose();
      outlineMat.dispose();
      geometry.dispose();
    },
    [petalMat, outlineMat, geometry],
  );

  const meshRef = useRef(null);
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return undefined;
    const outline = attachOutline(mesh, outlineMat);
    return () => {
      outline.removeFromParent();
    };
  }, [outlineMat]);

  useLayoutEffect(() => {
    const { petal: petalU } = flowerUniforms;
    petalU.colorLevels.value = look.colorLevels;
    petalU.thresholdLow.value = look.thresholdLow;
    petalU.thresholdHigh.value = look.thresholdHigh;
    petalU.thresholdNoiseScale.value = look.thresholdNoiseScale;
    petalU.thresholdNoiseStrength.value = look.thresholdNoiseStrength;
    petalU.shadowTint.value.set(look.shadowTint);
    petalU.highlightTint.value.set(look.highlightTint);
    petalU.baseColor.value.set(look.albedo);
    petalU.midColor.value.set(look.albedo);
    petalU.tipColor.value.set(look.albedo);
    petalU.saturation.value = look.saturation;
    outlineMat.userData.outlineUniforms.edgeColor.value.set(look.edgeColor);
    outlineMat.userData.outlineUniforms.outlineWidth.value = look.outlineWidth;
  }, [look, flowerUniforms, outlineMat]);

  return (
    <mesh
      ref={meshRef}
      name="Demo1WoodblockToonSphere"
      position={[0, SPHERE_RADIUS, 0]}
      geometry={geometry}
      material={petalMat}
      castShadow
    />
  );
}
