import * as THREE from 'three/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { useControls, folder } from 'leva';
import Stats from 'stats-gl';

// @ts-ignore
import { createSilkWeaveNode, createSilkWeaveUniforms } from './effects/createSilkWeaveNode';
// @ts-ignore
import { SILK_WEAVE_DEFAULTS } from './effects/silkWeaveDefaults';

// @ts-ignore
import 'stats-gl/addons/StatsGLNode';

export default function Effects() {
    const { gl, scene, camera } = useThree()

    const postProcessingRef = useRef<THREE.PostProcessing>(null);
    const statsRef = useRef<Stats>(null);

    const silkUniforms = useMemo(() => createSilkWeaveUniforms(), []);

    const silkControls = useControls('PostFX', {
        SilkWeave: folder({
            enabled: { value: SILK_WEAVE_DEFAULTS.enabled },
            threadCount: { value: SILK_WEAVE_DEFAULTS.threadCount, min: 40, max: 1200, step: 1 },
            strength: { value: SILK_WEAVE_DEFAULTS.strength, min: 0, max: 1, step: 0.01 },
            sharpness: { value: SILK_WEAVE_DEFAULTS.sharpness, min: 0.1, max: 4, step: 0.05 },
            threadVariation: { value: SILK_WEAVE_DEFAULTS.threadVariation, min: 0, max: 0.6, step: 0.01 },
            irregularity: { value: SILK_WEAVE_DEFAULTS.irregularity, min: 0, max: 1, step: 0.01 },
            tintColor: { value: SILK_WEAVE_DEFAULTS.tintColor },
            tintStrength: { value: SILK_WEAVE_DEFAULTS.tintStrength, min: 0, max: 1, step: 0.01 },
            blotchScale: { value: SILK_WEAVE_DEFAULTS.blotchScale, min: 1, max: 30, step: 0.5 },
            blotchStrength: { value: SILK_WEAVE_DEFAULTS.blotchStrength, min: 0, max: 1, step: 0.01 },
        }),
    });

    useEffect(() => {
        silkUniforms.enabled.value = silkControls.enabled ? 1 : 0;
        silkUniforms.threadCount.value = silkControls.threadCount;
        silkUniforms.strength.value = silkControls.strength;
        silkUniforms.sharpness.value = silkControls.sharpness;
        silkUniforms.threadVariation.value = silkControls.threadVariation;
        silkUniforms.irregularity.value = silkControls.irregularity;
        (silkUniforms.tintColor.value as THREE.Color).set(silkControls.tintColor);
        silkUniforms.tintStrength.value = silkControls.tintStrength;
        silkUniforms.blotchScale.value = silkControls.blotchScale;
        silkUniforms.blotchStrength.value = silkControls.blotchStrength;
    }, [silkUniforms, silkControls]);

    useEffect(() => {
        if (!gl || !(gl instanceof WebGPURenderer)) return;

        const stats = new Stats({
            logsPerSecond: 20,
            samplesLog: 100,
            samplesGraph: 10,
            precision: 2,
            horizontal: true,
            minimal: false,
            mode: 0,
        });
        document.body.appendChild(stats.dom);
        stats.init(gl);
        statsRef.current = stats;


        const renderer = gl as WebGPURenderer;
        const pp = new THREE.PostProcessing(renderer);

        // @ts-ignore
        const scenePass = pass(scene, camera)

        pp.outputNode = createSilkWeaveNode(scenePass, silkUniforms);
        postProcessingRef.current = pp;

        return () => {
            document.body.removeChild(stats.dom);
            statsRef.current = null;
            postProcessingRef.current = null;
        };
    }, [gl, scene, camera, silkUniforms]);

    useFrame(() => {
        postProcessingRef.current?.render();
        statsRef.current?.update();
    }, 1);

    return null;
}
