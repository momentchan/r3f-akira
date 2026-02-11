import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import * as THREE from 'three'


const SHADOW_RANGE = 1;

export function DirectionalLight() {
    const directionalLightRef = useRef<THREE.DirectionalLight>(null)
    const helperRef = useRef<THREE.DirectionalLightHelper | null>(null)
    const { scene } = useThree()
    
    const { rotationSpeed, color, intensity, debug, shadowBias } = useControls('Directional Light', {
        rotationSpeed: { value: 0.5, min: 0, max: 2, step: 0.1 },
        color: { value: '#ffffff' },
        intensity: { value: 2.0, min: 0, max: 3, step: 0.1 },
        debug: { value: false },
        shadowBias: { value: -0.0005, min: -0.01, max: 0.01, step: 0.0001 },
    }, { collapsed: true })

    const basePosition = useMemo(() => new THREE.Vector3(0, 5, 5), [])
    const positionRef = useRef(new THREE.Vector3())
    const rotationMatrixRef = useRef(new THREE.Matrix4())

    // Manage helper visibility
    useEffect(() => {
        if (!directionalLightRef.current) return
        
        if (debug && !helperRef.current) {
            // Create helper
            const helper = new THREE.DirectionalLightHelper(directionalLightRef.current, 1, 'red')
            helperRef.current = helper
            scene.add(helper)
        } else if (!debug && helperRef.current) {
            // Remove helper
            scene.remove(helperRef.current)
            helperRef.current.dispose()
            helperRef.current = null
        }
        
        return () => {
            // Cleanup on unmount
            if (helperRef.current) {
                scene.remove(helperRef.current)
                helperRef.current.dispose()
                helperRef.current = null
            }
        }
    }, [debug, scene])

    // Update light properties
    useEffect(() => {
        if (!directionalLightRef.current) return

        const light = directionalLightRef.current

        // Update light color and intensity
        light.color.set(color)
        light.intensity = intensity
    }, [color, intensity])

    useFrame((state) => {
        if (!directionalLightRef.current) return

        const rotationY = state.clock.elapsedTime * rotationSpeed
        positionRef.current.copy(basePosition)
        rotationMatrixRef.current.makeRotationY(rotationY)
        positionRef.current.applyMatrix4(rotationMatrixRef.current)
        directionalLightRef.current.position.copy(positionRef.current)
        
        // Update helper if it exists
        if (helperRef.current) {
            helperRef.current.update()
        }
    })

    return (
        <directionalLight
            ref={directionalLightRef}
            position={basePosition.toArray()}
            intensity={intensity}
            color={color}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-near={0.1}
            shadow-camera-far={50}
            shadow-camera-left={-SHADOW_RANGE}
            shadow-camera-right={SHADOW_RANGE}
            shadow-camera-top={SHADOW_RANGE}
            shadow-camera-bottom={-SHADOW_RANGE}
            shadow-bias={shadowBias}
        />
    )
}

