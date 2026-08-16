import { useEffect, useId, useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import {
  useVATPreloader,
} from '@core/vat';
import { AsyncCompile } from '@core';
import {
  configureFlowerTexture,
  FLOWER_MASK_PATH,
  FLOWER_VEIN_PATH,
} from '../look/flowerControls';
import { STEM_Y_MAX } from '../field/paths';
import { configureVatTexture, createVatFlowerMaterials } from './createVatMaterial';
import { extractFlowerMeshGeometries } from './flowerGeometry';

export function VatFlower({
  metaUrl,
  scaleMul = 1,
  frameRatio = null,
  stemYMax = STEM_Y_MAX,
  partColorMode = 'auto',
  flipX = true,
  usePetalCutout = true,
  useMaskEdge = true,
  maskPath = FLOWER_MASK_PATH,
  veinPath = FLOWER_VEIN_PATH,
  flowerUniforms,
  maskUniforms,
}) {
  const vatData = useVATPreloader(metaUrl);
  const maskTexture = useTexture(maskPath);
  const veinTexture = useTexture(veinPath);
  const instanceId = useId();

  useEffect(() => {
    configureFlowerTexture(maskTexture);
    configureFlowerTexture(veinTexture);
  }, [maskTexture, veinTexture]);

  const meshParts = useMemo(() => {
    if (!vatData.isLoaded || !vatData.scene || !vatData.meta) {
      return null;
    }

    return extractFlowerMeshGeometries(vatData.scene, vatData.meta, {
      flipX,
      stemYMax,
      partColorMode,
    });
  }, [vatData, stemYMax, flipX, partColorMode]);

  const materialBundle = useMemo(() => {
    if (!vatData.isLoaded || !vatData.posTex || !vatData.nrmTex || !vatData.meta) {
      return null;
    }

    configureVatTexture(vatData.posTex);
    configureVatTexture(vatData.nrmTex);

    return createVatFlowerMaterials(
      vatData.posTex,
      vatData.nrmTex,
      vatData.meta,
      flowerUniforms,
      maskUniforms,
      maskTexture,
      veinTexture,
      { usePetalCutout, useMaskEdge },
    );
  }, [
    vatData, flowerUniforms, maskUniforms,
    maskTexture, veinTexture, usePetalCutout, useMaskEdge,
  ]);

  useEffect(() => () => {
    materialBundle?.material.dispose();
    meshParts?.forEach(({ geometry }) => geometry.dispose());
  }, [materialBundle, meshParts]);

  useFrame(() => {
    if (!materialBundle) {
      return;
    }
    const r = frameRatio ? frameRatio.current : 0;
    materialBundle.frameUniform.value = r < 0 ? 0 : r > 1 ? 1 : r;
  }, 1);

  if (!meshParts?.length || !materialBundle) {
    return null;
  }

  return (
    <AsyncCompile id={`${metaUrl}-${instanceId}`}>
      <group scale={scaleMul}>
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
    </AsyncCompile>
  );
}
