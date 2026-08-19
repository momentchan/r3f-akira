import * as THREE from 'three/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { useControls, folder } from 'leva';
import Stats from 'stats-gl';
import { createSilkWeaveNode, createSilkWeaveUniforms } from '../postfx/createSilkWeaveNode';
import { SILK_WEAVE_DEFAULTS } from '../postfx/silkWeaveDefaults';
import { isDebugRoute } from '../../core/debugRoute';
import 'stats-gl/addons/StatsGLNode';

export default function Effects() {
    const { gl, scene, camera } = useThree()

    const postProcessingRef = useRef<THREE.PostProcessing>(null);
    const statsRef = useRef<Stats>(null);

    const silkUniforms = useMemo(() => createSilkWeaveUniforms(SILK_WEAVE_DEFAULTS), []);

    const d = SILK_WEAVE_DEFAULTS;
    const silkControls = useControls('PostFX', {
        SilkWeave: folder({
            enabled: { value: d.enabled },
            threadCount: { value: d.threadCount, min: 40, max: 1200, step: 1 },
            strength: { value: d.strength, min: 0, max: 1, step: 0.01 },
            sharpness: { value: d.sharpness, min: 0.1, max: 4, step: 0.05 },
            threadVariation: { value: d.threadVariation, min: 0, max: 0.6, step: 0.01 },
            irregularity: { value: d.irregularity, min: 0, max: 1, step: 0.01 },
            tintColor: { value: d.tintColor },
            tintStrength: { value: d.tintStrength, min: 0, max: 1, step: 0.01 },
            blotchScale: { value: d.blotchScale, min: 1, max: 30, step: 0.5 },
            blotchStrength: { value: d.blotchStrength, min: 0, max: 1, step: 0.01 },
        }, { collapsed: true }),
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

        const showStats = isDebugRoute();
        if (showStats) {
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
        }

        const renderer = gl as WebGPURenderer;
        const pp = new THREE.PostProcessing(renderer);
        const scenePass = pass(scene, camera)

        pp.outputNode = createSilkWeaveNode(scenePass, silkUniforms);
        postProcessingRef.current = pp;

        return () => {
            if (statsRef.current) {
                document.body.removeChild(statsRef.current.dom);
                statsRef.current = null;
            }
            postProcessingRef.current = null;
        };
    }, [gl, scene, camera, silkUniforms]);

    // `enabled` only mixes the weave away at the end of the shader, so the full
    // per-pixel cost is still paid when it is off. Bypass the whole pass instead
    // and draw the scene directly — the output is what the mix already produced.
    useFrame(() => {
        const pp = postProcessingRef.current;
        if (pp && silkControls.enabled) {
            pp.render();
        } else if (gl) {
            gl.render(scene, camera);
        }
        statsRef.current?.update();
    }, 1);

    return null;
}
