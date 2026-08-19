import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import * as THREE from 'three'
import { LIGHTING_DEFAULTS } from './lightingDefaults'
import {
    PLANT_SHADOW_LAYER,
    PLANT_SHADOW_LIGHT_FLAG,
} from './plantShadowLayer'

const SHADOW_RANGE = 3;
const SHADOW_MAP_SIZES = [512, 1024, 2048, 4096];

export function DirectionalLight() {
    const directionalLightRef = useRef<THREE.DirectionalLight>(null)
    const plantShadowLightRef = useRef<THREE.DirectionalLight>(null)
    const helperRef = useRef<THREE.DirectionalLightHelper | null>(null)
    const { scene } = useThree()
    const d = LIGHTING_DEFAULTS;

    const {
        rotationSpeed, color, intensity, debug, shadowBias, shadowRadius,
        plantShadowMapSize, plantShadowRadius,
    } = useControls('Lighting', {
        rotationSpeed: { value: d.rotationSpeed, min: 0, max: 2, step: 0.1 },
        color: { value: d.color },
        intensity: { value: d.intensity, min: 0, max: 3, step: 0.1 },
        debug: { value: d.debug },
        shadowBias: { value: d.shadowBias, min: -0.01, max: 0.01, step: 0.0001 },
        shadowRadius: { value: d.shadowRadius, min: 0, max: 25, step: 0.5, label: 'shadow softness' },
        plantShadowMapSize: {
            value: d.plantShadowMapSize,
            options: SHADOW_MAP_SIZES,
            label: 'char shadow res',
        },
        plantShadowRadius: {
            value: d.shadowRadius,
            min: 0,
            max: 25,
            step: 0.5,
            label: 'char shadow softness',
        },
    }, { collapsed: true })

    const basePosition = useMemo(() => new THREE.Vector3(0, 3.5, 3), [])
    const positionRef = useRef(new THREE.Vector3())
    const rotationMatrixRef = useRef(new THREE.Matrix4())

    useEffect(() => {
        if (!directionalLightRef.current) return

        if (debug && !helperRef.current) {
            const helper = new THREE.DirectionalLightHelper(directionalLightRef.current, 1, 'red')
            helperRef.current = helper
            scene.add(helper)
        } else if (!debug && helperRef.current) {
            scene.remove(helperRef.current)
            helperRef.current.dispose()
            helperRef.current = null
        }

        return () => {
            if (helperRef.current) {
                scene.remove(helperRef.current)
                helperRef.current.dispose()
                helperRef.current = null
            }
        }
    }, [debug, scene])

    useEffect(() => {
        if (!directionalLightRef.current) return
        const light = directionalLightRef.current
        light.color.set(color)
        light.intensity = intensity
    }, [color, intensity])

    useEffect(() => {
        const light = plantShadowLightRef.current
        if (!light) return
        light.userData[PLANT_SHADOW_LIGHT_FLAG] = true
        // Restricting the shadow camera to the plant layer is what keeps the
        // character out of this depth map, so it can receive flower shadows
        // without casting onto itself. three only honours this mask when a bit
        // above 0 is set; otherwise it inherits the view camera's (three.webgpu
        // ShadowNode.updateShadow, the `& 0xFFFFFFFE` check).
        light.shadow.camera.layers.set(PLANT_SHADOW_LAYER)
    }, [])

    useFrame((state) => {
        if (!directionalLightRef.current) return

        const rotationY = state.clock.elapsedTime * rotationSpeed
        positionRef.current.copy(basePosition)
        rotationMatrixRef.current.makeRotationY(rotationY)
        positionRef.current.applyMatrix4(rotationMatrixRef.current)
        directionalLightRef.current.position.copy(positionRef.current)
        if (plantShadowLightRef.current) {
            plantShadowLightRef.current.position.copy(positionRef.current)
        }

        if (helperRef.current) {
            helperRef.current.update()
        }
    })

    // Shared frustum and bias keep the ground shadow and the shadow the
    // character receives registered to each other. Resolution and softness are
    // per-light: the plant map is only ever sampled by the character.
    const shadowProps = {
        castShadow: true,
        position: basePosition.toArray() as [number, number, number],
        'shadow-camera-near': 0.1,
        'shadow-camera-far': 50,
        'shadow-camera-left': -SHADOW_RANGE,
        'shadow-camera-right': SHADOW_RANGE,
        'shadow-camera-top': SHADOW_RANGE,
        'shadow-camera-bottom': -SHADOW_RANGE,
        'shadow-bias': shadowBias,
    }

    return (
        <>
            <directionalLight
                ref={directionalLightRef}
                intensity={intensity}
                color={color}
                shadow-mapSize={[d.shadowMapSize, d.shadowMapSize]}
                shadow-radius={shadowRadius}
                {...shadowProps}
            />
            {/* Shadow-only: contributes no light, exists so the character can
                sample a depth map that holds plants but not itself. */}
            <directionalLight
                ref={plantShadowLightRef}
                intensity={0}
                shadow-mapSize={[plantShadowMapSize, plantShadowMapSize]}
                shadow-radius={plantShadowRadius}
                {...shadowProps}
            />
        </>
    )
}
