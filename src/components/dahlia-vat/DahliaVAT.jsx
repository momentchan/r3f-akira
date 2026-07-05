import { useEffect, useMemo, useRef } from 'react';
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import {
  calculateVATFrame,
  extractGeometryFromScene,
  preloadVATAssets,
  setupVATGeometry,
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
    () => createFlowerControlsSchema({ mask: { edgeWidth: 0.005 } }),
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

  const geometry = useMemo(() => {
    if (!vatData.isLoaded || !vatData.scene || !vatData.meta) {
      return null;
    }

    const extracted = extractGeometryFromScene(vatData.scene);
    if (!extracted) {
      return null;
    }

    setupVATGeometry(extracted, vatData.meta, { flipX: true });
    return extracted;
  }, [vatData]);

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
    materialBundle?.fillMaterial.dispose();
    geometry?.dispose();
  }, [materialBundle, geometry]);

  useEffect(() => {
    if (!materialBundle) {
      return;
    }

    syncFlowerControls(
      flowerControls,
      flowerUniforms,
      maskUniforms,
      outlineUniforms,
      { fillMaterial: materialBundle.fillMaterial },
    );
  }, [flowerControls, flowerUniforms, maskUniforms, outlineUniforms, materialBundle]);

  useFrame(({ clock, scene }) => {
    if (!materialBundle || !vatData.meta) {
      return;
    }

    materialBundle.frameUniform.value = calculateVATFrame(
      vatControls.useTime ? undefined : vatControls.frame,
      clock.elapsedTime,
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

  if (!geometry || !materialBundle) {
    return null;
  }

  return (
    <mesh
      geometry={geometry}
      material={materialBundle.fillMaterial}
      position={position}
      scale={vatControls.scale}
      visible={visible}
      frustumCulled={false}
      castShadow
      receiveShadow
    />
  );
}

preloadVATAssets(DAHLIA_VAT_META_PATH);
