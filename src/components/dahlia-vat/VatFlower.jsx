import { useEffect, useId, useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import {
  extractMeshGeometriesFromScene,
  useVATPreloader,
} from '@core/vat';
import { AsyncCompile } from '@core';
import {
  configureFlowerTexture,
  FLOWER_MASK_PATH,
  FLOWER_VEIN_PATH,
} from '../flower/flowerControls';
import { configureVatTexture, createVatFlowerMaterials } from './createVatMaterial';
import { STEM_Y_MAX } from './config';

// Shared VAT flower renderer. Flower-type wrappers (DahliaVAT, RoseVAT) only
// supply asset paths / extract options; material look is owned by the parent
// via the uniform bundles so each plant can sync its own type's Leva panel.
export function VatFlower({
  metaUrl,
  scaleMul = 1,
  frameRatio = null, // { current: number } ref in [0,1]; decreasing → reverse
  stemYMax = STEM_Y_MAX,
  flipX = true,
  maskPath = FLOWER_MASK_PATH,
  veinPath = FLOWER_VEIN_PATH,
  flowerUniforms,
  maskUniforms,
  outlineUniforms,
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

    return extractMeshGeometriesFromScene(vatData.scene, vatData.meta, {
      flipX,
      partColors: { stemYMax },
    });
  }, [vatData, stemYMax, flipX]);

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
      outlineUniforms,
      maskUniforms,
      maskTexture,
      veinTexture,
    );
  }, [vatData, flowerUniforms, outlineUniforms, maskUniforms, maskTexture, veinTexture]);

  useEffect(() => () => {
    materialBundle?.material.dispose();
    meshParts?.forEach(({ geometry }) => geometry.dispose());
  }, [materialBundle, meshParts]);

  useFrame(() => {
    if (!materialBundle) {
      return;
    }
    // Drive the VAT frame from the [0,1] ratio; a decreasing ratio plays reverse.
    // No time/speed math — the lifecycle owns timing.
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
