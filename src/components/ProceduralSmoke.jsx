import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import {
  createSmokeControlsSchema,
  SMOKE_DEFAULTS,
} from './procedural-smoke/proceduralSmokeDefaults';
import { createOutlineMaterial, createPuffMaterial } from './procedural-smoke/createSmokeMaterials';
import { createSmokeSimulation } from './procedural-smoke/createSmokeSimulation';

export function ProceduralSmoke({
  count = SMOKE_DEFAULTS.simulation.puffCount,
  position = [0, 0, 0],
  seed = SMOKE_DEFAULTS.simulation.randomSeed,
}) {
  const meshRef = useRef(null);
  const outlineRef = useRef(null);
  const directionalLightRef = useRef(null);
  const lightWorldPosition = useRef(new THREE.Vector3());
  const lightTargetPosition = useRef(new THREE.Vector3());
  const pausedRef = useRef(false);

  const smokeControlsSchema = useMemo(
    () => createSmokeControlsSchema(count, seed),
    [count, seed],
  );

  const {
    curlScale,
    deformBig,
    deformSmall,
    distortBigScale,
    distortBigSpeed,
    distortSmallScale,
    distortSmallSpeed,
    driftScale,
    heightScale,
    highlightColor,
    midColor,
    midThreshold,
    highThreshold,
    normalEpsilon,
    outlineColor,
    outlineWidth,
    puffCount,
    puffScale,
    radiusScale,
    scaleMax,
    scaleMin,
    randomSeed,
    rimPower,
    rimStrength,
    rimThreshold,
    shadowColor,
    speedScale,
    thresholdNoiseScale,
    thresholdNoiseStrength,
  } = useControls('Smoke Effect', smokeControlsSchema, { collapsed: true });

  const resolvedCount = Math.max(1, Math.floor(puffCount));
  const resolvedSeed = Math.max(1, Math.floor(randomSeed));
  const simulation = useMemo(
    () => createSmokeSimulation(resolvedCount, resolvedSeed),
    [resolvedCount, resolvedSeed],
  );
  const puffMaterial = useMemo(() => createPuffMaterial(), []);
  const outlineMaterialState = useMemo(() => createOutlineMaterial(), []);
  const material = puffMaterial.material;
  const outlineMaterial = outlineMaterialState.material;

  const geometry = useMemo(() => {
    const puffGeometry = new THREE.SphereGeometry(1, 64, 64);

    puffGeometry.setAttribute('smokeSeed', simulation.seedAttribute);
    puffGeometry.setAttribute('smokeAge', simulation.ageAttribute);

    return puffGeometry;
  }, [simulation]);

  useEffect(() => {
    if (meshRef.current) meshRef.current.instanceMatrix = simulation.matrixAttribute;
    if (outlineRef.current) outlineRef.current.instanceMatrix = simulation.matrixAttribute;
  }, [simulation.matrixAttribute]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => outlineMaterial.dispose(), [outlineMaterial]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key.toLowerCase() !== 'p' || event.repeat) return;

      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      pausedRef.current = !pausedRef.current;
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const { uniforms } = simulation;

    uniforms.curlScale.value = curlScale;
    uniforms.driftScale.value = driftScale;
    uniforms.heightScale.value = heightScale;
    uniforms.radiusScale.value = radiusScale;
    uniforms.scale.value = puffScale;
    uniforms.scaleMin.value = scaleMin;
    uniforms.scaleMax.value = scaleMax;
    uniforms.speedScale.value = speedScale;
  }, [
    curlScale,
    driftScale,
    heightScale,
    puffScale,
    radiusScale,
    scaleMax,
    scaleMin,
    simulation,
    speedScale,
  ]);

  useEffect(() => {
    const puffUniforms = puffMaterial.uniforms;
    const outlineUniforms = outlineMaterialState.uniforms;

    puffUniforms.deformBig.value = deformBig;
    puffUniforms.deformSmall.value = deformSmall;
    puffUniforms.distortBigScale.value = distortBigScale;
    puffUniforms.distortBigSpeed.value = distortBigSpeed;
    puffUniforms.distortSmallScale.value = distortSmallScale;
    puffUniforms.distortSmallSpeed.value = distortSmallSpeed;
    puffUniforms.highlightColor.value.set(highlightColor);
    puffUniforms.midColor.value.set(midColor);
    puffUniforms.normalEpsilon.value = normalEpsilon;
    puffUniforms.rimStrength.value = rimStrength;
    puffUniforms.rimThreshold.value = rimThreshold;
    puffUniforms.rimPower.value = rimPower;
    puffUniforms.midThreshold.value = midThreshold;
    puffUniforms.highThreshold.value = highThreshold;
    puffUniforms.shadowColor.value.set(shadowColor);
    puffUniforms.thresholdNoiseScale.value = thresholdNoiseScale;
    puffUniforms.thresholdNoiseStrength.value = thresholdNoiseStrength;

    outlineUniforms.deformBig.value = deformBig;
    outlineUniforms.deformSmall.value = deformSmall;
    outlineUniforms.distortBigScale.value = distortBigScale;
    outlineUniforms.distortBigSpeed.value = distortBigSpeed;
    outlineUniforms.distortSmallScale.value = distortSmallScale;
    outlineUniforms.distortSmallSpeed.value = distortSmallSpeed;
    outlineUniforms.outlineColor.value.set(outlineColor);
    outlineUniforms.outlineWidth.value = outlineWidth;
  }, [
    deformBig,
    deformSmall,
    distortBigScale,
    distortBigSpeed,
    distortSmallScale,
    distortSmallSpeed,
    highlightColor,
    midColor,
    midThreshold,
    highThreshold,
    normalEpsilon,
    outlineColor,
    outlineMaterialState,
    outlineWidth,
    puffMaterial,
    rimPower,
    rimStrength,
    rimThreshold,
    shadowColor,
    thresholdNoiseScale,
    thresholdNoiseStrength,
  ]);

  useFrame(({ gl }) => {
    if (!meshRef.current || !outlineRef.current || !gl.compute || pausedRef.current) return;
    gl.compute(simulation.computeNode);
  });

  // Run after DirectionalLight updates position (default priority 0).
  useFrame(({ scene }) => {
    if (!directionalLightRef.current) {
      scene.traverse((object) => {
        if (object.isDirectionalLight) {
          directionalLightRef.current = object;
        }
      });
    }

    const light = directionalLightRef.current;
    if (!light) return;

    light.updateWorldMatrix(true, false);
    light.target.updateWorldMatrix(true, false);
    light.getWorldPosition(lightWorldPosition.current);
    light.target.getWorldPosition(lightTargetPosition.current);
    puffMaterial.uniforms.lightDir.value
      .subVectors(lightWorldPosition.current, lightTargetPosition.current)
      .normalize();
  }, 1);

  return (
    <group position={position} dispose={null}>
      <instancedMesh
        ref={(mesh) => {
          outlineRef.current = mesh;
          if (mesh) mesh.instanceMatrix = simulation.matrixAttribute;
        }}
        args={[geometry, outlineMaterial, resolvedCount]}
        frustumCulled={false}
        renderOrder={0}
      />
      <instancedMesh
        ref={(mesh) => {
          meshRef.current = mesh;
          if (mesh) mesh.instanceMatrix = simulation.matrixAttribute;
        }}
        args={[geometry, material, resolvedCount]}
        frustumCulled={false}
        renderOrder={1}
      />
    </group>
  );
}
