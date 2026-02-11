import * as THREE from 'three/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';
import { vec4, pass, addMethodChaining } from 'three/tsl';
import Stats from 'stats-gl';
// @ts-ignore
import { statsGL } from 'stats-gl/addons/StatsGLNode';
addMethodChaining('toStatsGL', statsGL);

export default function Effects() {
    const { gl, scene, camera } = useThree()

    const postProcessingRef = useRef<THREE.PostProcessing>(null);
    const statsRef = useRef<Stats>(null);

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
        const scenePass = pass(scene, camera).toStatsGL('Test', stats);
        scenePass.getLinearDepthNode().toStatsGL('Depth', stats);
        
        pp.outputNode = scenePass;
        postProcessingRef.current = pp;

        return () => {
            document.body.removeChild(stats.dom);
            statsRef.current = null;
            postProcessingRef.current = null;
        };
    }, [gl, scene, camera]);

    useFrame(() => {
        postProcessingRef.current?.render();
        statsRef.current?.update();
    }, 1);

    return null;
}