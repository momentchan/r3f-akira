import { useEffect, useMemo, useRef } from 'react';
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import {
  calculateVATFrame,
  extractMeshGeometriesFromScene,
  preloadVATAssets,
  useVATPreloader,
} from '@core/vat';
import {
  createFlowerMaskUniforms,
  createFlowerOutlineUniforms,
  createFlowerUniforms,
} from '../flower/createFlowerMaterials';
import {
  configureFlowerTexture,
  createFlowerControlsSchema,
  FLOWER_MASK_PATH,
  FLOWER_VEIN_PATH,
  syncFlowerControls,
} from '../flower/flowerControls';
import {
  configureVatTexture,
  createVatFlowerMaterials,
} from './createVatMaterial';
import {
  createDahliaVatControlsSchema,
  DAHLIA_VAT_META_PATH,
} from './dahliaVatDefaults';

export function DahliaVAT({
  metaUrl = DAHLIA_VAT_META_PATH,
  position = [0, 0, 0],
  scaleMul = 1,
  timeOffset = 0,
  visible = true,
}) {
  const vatData = useVATPreloader(metaUrl);
  const maskTexture = useTexture(FLOWER_MASK_PATH);
  const veinTexture = useTexture(FLOWER_VEIN_PATH);
  const directionalLightRef = useRef(null);
  const lightWorldPosition = useRef(new THREE.Vector3());
  const lightTargetPosition = useRef(new THREE.Vector3());

  const vatControls = useControls(
    'Dahlia VAT',
    createDahliaVatControlsSchema(),
    { collapsed: true },
  );
  const flowerControlsSchema = useMemo(
    () => createFlowerControlsSchema({ mask: { edgeWidth: 0.001 } }),
    [],
  );
  const flowerControls = useControls('Flower', flowerControlsSchema, { collapsed: true });

  const flowerUniforms = useMemo(() => createFlowerUniforms(), []);
  const maskUniforms = useMemo(() => createFlowerMaskUniforms(), []);
  const outlineUniforms = useMemo(() => createFlowerOutlineUniforms(), []);

  useEffect(() => {
    configureFlowerTexture(maskTexture);
    configureFlowerTexture(veinTexture);
  }, [maskTexture, veinTexture]);

  const meshParts = useMemo(() => {
    if (!vatData.isLoaded || !vatData.scene || !vatData.meta) {
      return null;
    }

    return extractMeshGeometriesFromScene(vatData.scene, vatData.meta, {
      flipX: true,
      partColors: { stemYMax: vatControls.stemYMax },
    });
  }, [vatData, vatControls.stemYMax]);

  const materialBundle = useMemo(() => {
    if (
      !vatData.isLoaded ||
      !vatData.posTex ||
      !vatData.nrmTex ||
      !vatData.meta
    ) {
      return null;
    }

    configureVatTexture(vatData.posTex);
    configureVatTexture(vatData.nrmTex);

    return createVatFlowerMaterials(
      vatData.posTex,
      vatData.nrmTex,
      vatData.meta,
      flowerUniforms,
      outlineUniforms,
      maskUniforms,
      maskTexture,
      veinTexture,
    );
  }, [
    vatData,
    flowerUniforms,
    outlineUniforms,
    maskUniforms,
    maskTexture,
    veinTexture,
  ]);

  useEffect(() => () => {
    materialBundle?.material.dispose();
    meshParts?.forEach(({ geometry }) => geometry.dispose());
  }, [materialBundle, meshParts]);

  useEffect(() => {
    if (!materialBundle) {
      return;
    }

    syncFlowerControls(
      flowerControls,
      flowerUniforms,
      maskUniforms,
      outlineUniforms,
      { fillMaterial: materialBundle.material },
    );
  }, [flowerControls, flowerUniforms, maskUniforms, outlineUniforms, materialBundle]);

  useFrame(({ clock, scene }) => {
    if (!materialBundle || !vatData.meta) {
      return;
    }

    materialBundle.frameUniform.value = calculateVATFrame(
      vatControls.useTime ? undefined : vatControls.frame,
      clock.elapsedTime + timeOffset,
      vatData.meta,
      vatControls.speed,
    );

    if (!directionalLightRef.current) {
      scene.traverse((object) => {
        if (object.isDirectionalLight) {
          directionalLightRef.current = object;
        }
      });
    }

    const light = directionalLightRef.current;
    if (!light) {
      return;
    }

    light.updateWorldMatrix(true, false);
    light.target.updateWorldMatrix(true, false);
    light.getWorldPosition(lightWorldPosition.current);
    light.target.getWorldPosition(lightTargetPosition.current);
    flowerUniforms.lightDir.value
      .subVectors(lightWorldPosition.current, lightTargetPosition.current)
      .normalize();
  }, 1);

  if (!meshParts?.length || !materialBundle) {
    return null;
  }

  return (
    <group position={position} scale={vatControls.scale * scaleMul} visible={visible}>
      {meshParts.map(({ name, geometry }) => (
        <mesh
          key={name}
          geometry={geometry}
          material={materialBundle.material}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

preloadVATAssets(DAHLIA_VAT_META_PATH);
