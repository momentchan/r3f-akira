import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { ANCHOR_COLORS } from './fieldAnchors';

const _m = new THREE.Matrix4();
const _c = new THREE.Color();

/**
 * Live clump hearts. Pins stay put; these hop on migrateSpeed / migrateRange.
 * Color matches the parent pin.
 */
export function HeartDebug({
  runtimeRef,
  visible = false,
  capacity = 64,
}) {
  const mesh = useMemo(() => {
    const geo = new THREE.SphereGeometry(0.045, 12, 10);
    const mat = new THREE.MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
    });
    const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, capacity));
    inst.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(Math.max(1, capacity) * 3),
      3,
    );
    inst.frustumCulled = false;
    inst.count = 0;
    return inst;
  }, [capacity]);

  useEffect(() => () => {
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh.dispose();
  }, [mesh]);

  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useFrame(() => {
    if (!visibleRef.current) {
      if (mesh.count !== 0) mesh.count = 0;
      return;
    }
    const hearts = runtimeRef.current?.hearts ?? [];
    const cap = mesh.instanceMatrix.count;
    const shown = Math.min(hearts.length, cap);
    for (let i = 0; i < shown; i += 1) {
      const h = hearts[i];
      _m.makeTranslation(h.cx, 0.07, h.cz);
      mesh.setMatrixAt(i, _m);
      _c.set(ANCHOR_COLORS[(h.anchorIndex ?? 0) % ANCHOR_COLORS.length]);
      mesh.setColorAt(i, _c);
    }
    mesh.count = shown;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
