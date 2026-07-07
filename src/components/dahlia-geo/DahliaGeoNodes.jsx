import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useGLTF, useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three/webgpu';
import {
  createFlowerMaskUniforms,
  createFlowerOutlineMaterial,
  createFlowerOutlineUniforms,
  createFlowerPetalMaterial,
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
  createDahliaGeoControlsSchema,
  createInstanceScratch,
  PETAL_PATH,
  preparePetalGeometry,
  updateDahliaInstances,
} from './dahliaGeoDefaults';

const MAX_PETALS = 400;

function findFirstMesh(scene) {
  let found = null;
  scene.traverse((object) => {
    if (!found && object.isMesh) {
      found = object;
    }
  });
  return found;
}

// Mirror the fill mesh's per-instance matrices onto the outline mesh so both
// passes stay in lockstep without laying the flower out twice.
function copyInstanceMatrices(target, source) {
  if (!target) return;
  target.count = source.count;
  target.instanceMatrix.array.set(source.instanceMatrix.array);
  target.instanceMatrix.needsUpdate = true;
  target.boundingSphere = source.boundingSphere;
}

export function DahliaGeoNodes({ position = [0, 0, 0], visible = true }) {
  const { scene } = useGLTF(PETAL_PATH);
  const maskTexture = useTexture(FLOWER_MASK_PATH);
  const veinTexture = useTexture(FLOWER_VEIN_PATH);

  const fillRef = useRef(null);
  const outlineRef = useRef(null);
  const directionalLightRef = useRef(null);
  const lightWorldPosition = useRef(new THREE.Vector3());
  const lightTargetPosition = useRef(new THREE.Vector3());
  const scratch = useMemo(() => createInstanceScratch(), []);

  const geoControls = useControls('Dahlia (Geo Nodes)', createDahliaGeoControlsSchema(), {
    collapsed: true,
  });
  // Same material configuration as the VAT dahlia flower.
  const flowerControlsSchema = useMemo(
    () => createFlowerControlsSchema({ mask: { edgeWidth: 0.001 } }),
    [],
  );
  const flowerControls = useControls('Flower', flowerControlsSchema, { collapsed: true });

  // Shared toon-flower material uniforms (same set the dahlia/VAT flower uses).
  const flowerUniforms = useMemo(() => createFlowerUniforms(), []);
  const maskUniforms = useMemo(() => createFlowerMaskUniforms(), []);
  const outlineUniforms = useMemo(() => createFlowerOutlineUniforms(), []);

  useEffect(() => {
    configureFlowerTexture(maskTexture);
    configureFlowerTexture(veinTexture);
  }, [maskTexture, veinTexture]);

  const sourceMesh = useMemo(() => findFirstMesh(scene), [scene]);

  // Petal fill uses the cartoon petal material (gradient + veins + mask + toon
  // shade); outline is the inflated back-face pass — same recipe as Flower.jsx.
  const fillMaterial = useMemo(
    () => createFlowerPetalMaterial(
      flowerUniforms,
      outlineUniforms,
      maskUniforms,
      maskTexture,
      veinTexture,
    ),
    [flowerUniforms, outlineUniforms, maskUniforms, maskTexture, veinTexture],
  );
  const outlineMaterial = useMemo(
    () => createFlowerOutlineMaterial(outlineUniforms, maskUniforms, maskTexture),
    [outlineUniforms, maskUniforms, maskTexture],
  );

  // Rebuild the shaped petal geometry whenever the shaping controls change.
  const geometry = useMemo(() => {
    if (!sourceMesh) return null;
    return preparePetalGeometry(sourceMesh, {
      petalWidth: geoControls.petalWidth,
      petalBend: geoControls.petalBend,
      petalLengthScale: geoControls.petalLengthScale,
      petalWidthScale: geoControls.petalWidthScale,
      petalThickness: geoControls.petalThickness,
    });
  }, [
    sourceMesh,
    geoControls.petalWidth,
    geoControls.petalBend,
    geoControls.petalLengthScale,
    geoControls.petalWidthScale,
    geoControls.petalThickness,
  ]);

  useEffect(() => () => {
    geometry?.dispose();
  }, [geometry]);

  useEffect(() => () => {
    fillMaterial.dispose();
    outlineMaterial.dispose();
  }, [fillMaterial, outlineMaterial]);

  // Re-lay the instances whenever an arrangement control changes.
  useLayoutEffect(() => {
    const fill = fillRef.current;
    if (!fill || !geometry) return;
    updateDahliaInstances(fill, geoControls, scratch);
    copyInstanceMatrices(outlineRef.current, fill);
  }, [geometry, geoControls, scratch]);

  // Keep the toon material uniforms in sync with the Flower control panel.
  useEffect(() => {
    syncFlowerControls(flowerControls, flowerUniforms, maskUniforms, outlineUniforms, {
      fillMaterial,
      outlineMaterial,
    });
  }, [flowerControls, flowerUniforms, maskUniforms, outlineUniforms, fillMaterial, outlineMaterial]);

  useFrame(({ clock, scene: rootScene }) => {
    const fill = fillRef.current;

    if (fill && geometry && geoControls.animate) {
      const bloom = (Math.sin(clock.elapsedTime * geoControls.animateSpeed) + 1) * 0.5;
      updateDahliaInstances(fill, { ...geoControls, bloom }, scratch);
      copyInstanceMatrices(outlineRef.current, fill);
    }

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

  if (!geometry) return null;

  return (
    <group
      position={position}
      rotation={[geoControls.viewTilt, 0, 0]}
      visible={visible}
      dispose={null}
    >
      <instancedMesh
        ref={outlineRef}
        args={[geometry, outlineMaterial, MAX_PETALS]}
        frustumCulled={false}
        renderOrder={0}
      />
      <instancedMesh
        ref={fillRef}
        args={[geometry, fillMaterial, MAX_PETALS]}
        frustumCulled={false}
        renderOrder={1}
        castShadow
        receiveShadow
      />
    </group>
  );
}

useGLTF.preload(PETAL_PATH);
