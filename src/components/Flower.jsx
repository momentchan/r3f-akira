import { useEffect, useMemo, useRef } from 'react';
import { useGLTF, useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import {
  applyCartoonMaterials,
  createFlowerMaskUniforms,
  createFlowerMaterial,
  createFlowerOutlineMaterial,
  createFlowerOutlineUniforms,
  createFlowerStemMaterial,
  createFlowerUniforms,
} from './flower/createFlowerMaterials';
import {
  createFlowerControlsSchema,
  configureFlowerTexture,
  FLOWER_MASK_PATH,
  FLOWER_VEIN_PATH,
  syncFlowerControls,
} from './flower/flowerControls';

const FLOWER_PATH = '/models/dahlia.glb';

function sortMeshesByCameraDepth(meshPairs, camera, cameraScratch, meshScratch) {
  camera.getWorldPosition(cameraScratch);

  meshPairs
    .map(({ fill, outline }) => {
      fill.getWorldPosition(meshScratch);
      return {
        fill,
        outline,
        depth: cameraScratch.distanceToSquared(meshScratch),
      };
    })
    .sort((a, b) => b.depth - a.depth)
    .forEach(({ fill, outline }, index) => {
      fill.renderOrder = index + 1;
      outline.renderOrder = index;
    });
}

export function Flower({ position = [0, 0, 0], scale = 1, visible = true }) {
  const { scene } = useGLTF(FLOWER_PATH);
  const maskTexture = useTexture(FLOWER_MASK_PATH);
  const veinTexture = useTexture(FLOWER_VEIN_PATH);
  const directionalLightRef = useRef(null);
  const lightWorldPosition = useRef(new THREE.Vector3());
  const lightTargetPosition = useRef(new THREE.Vector3());
  const cameraPositionScratch = useRef(new THREE.Vector3());
  const meshPositionScratch = useRef(new THREE.Vector3());
  const maskedMeshPairsRef = useRef([]);

  const controlsSchema = useMemo(() => createFlowerControlsSchema(), []);
  const controls = useControls('Flower', controlsSchema, { collapsed: true });

  const flowerUniforms = useMemo(() => createFlowerUniforms(), []);
  const maskUniforms = useMemo(() => createFlowerMaskUniforms(), []);
  const outlineUniforms = useMemo(() => createFlowerOutlineUniforms(), []);

  useEffect(() => {
    configureFlowerTexture(maskTexture);
    configureFlowerTexture(veinTexture);
  }, [maskTexture, veinTexture]);

  const maskedFillMaterial = useMemo(
    () => createFlowerMaterial(
      flowerUniforms,
      maskUniforms,
      outlineUniforms,
      maskTexture,
      veinTexture,
    ),
    [flowerUniforms, maskUniforms, outlineUniforms, maskTexture, veinTexture],
  );
  const maskedOutlineMaterial = useMemo(
    () => createFlowerOutlineMaterial(outlineUniforms, maskUniforms, maskTexture),
    [outlineUniforms, maskUniforms, maskTexture],
  );
  const stemFillMaterial = useMemo(
    () => createFlowerStemMaterial(flowerUniforms),
    [flowerUniforms],
  );
  const stemOutlineMaterial = useMemo(
    () => createFlowerOutlineMaterial(outlineUniforms),
    [outlineUniforms],
  );

  const { fillScene, outlineScene, maskedMeshPairs } = useMemo(
    () => applyCartoonMaterials(
      scene,
      maskedFillMaterial,
      maskedOutlineMaterial,
      stemFillMaterial,
      stemOutlineMaterial,
    ),
    [
      scene,
      maskedFillMaterial,
      maskedOutlineMaterial,
      stemFillMaterial,
      stemOutlineMaterial,
    ],
  );

  useEffect(() => {
    maskedMeshPairsRef.current = maskedMeshPairs;
  }, [maskedMeshPairs]);

  useEffect(() => () => {
    maskedFillMaterial.dispose();
    maskedOutlineMaterial.dispose();
    stemFillMaterial.dispose();
    stemOutlineMaterial.dispose();
  }, [
    maskedFillMaterial,
    maskedOutlineMaterial,
    stemFillMaterial,
    stemOutlineMaterial,
  ]);

  useEffect(() => {
    syncFlowerControls(
      controls,
      flowerUniforms,
      maskUniforms,
      outlineUniforms,
      {
        fillMaterial: maskedFillMaterial,
        outlineMaterial: maskedOutlineMaterial,
      },
    );
  }, [
    controls,
    flowerUniforms,
    maskUniforms,
    maskedFillMaterial,
    maskedOutlineMaterial,
    outlineUniforms,
  ]);

  useFrame(({ camera, scene: rootScene }) => {
    sortMeshesByCameraDepth(
      maskedMeshPairsRef.current,
      camera,
      cameraPositionScratch.current,
      meshPositionScratch.current,
    );

    if (!directionalLightRef.current) {
      rootScene.traverse((object) => {
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
    flowerUniforms.lightDir.value
      .subVectors(lightWorldPosition.current, lightTargetPosition.current)
      .normalize();
  }, 1);

  return (
    <group position={position} scale={scale} visible={visible} dispose={null}>
      <primitive object={outlineScene} />
      <primitive object={fillScene} />
    </group>
  );
}

useGLTF.preload(FLOWER_PATH);
