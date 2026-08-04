import { useMemo } from 'react';
import { useControls } from 'leva';
import { ProceduralStem } from './ProceduralStem';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function StemArrangement({ position = [0, 0, 0] }) {
  const { count, spreadRadius, stagger } = useControls('Arrangement', {
    count:        { value: 7,   min: 1, max: 30,  step: 1 },
    spreadRadius: { value: 0.3, min: 0, max: 1.5, step: 0.01 },
    stagger:      { value: 0.3, min: 0, max: 2,   step: 0.05, label: 'stagger (s)' },
  }, { collapsed: true });

  const stems = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const angle = i * GOLDEN_ANGLE;
      const r = i === 0 ? 0 : spreadRadius * Math.sqrt(i / (count - 1));
      return {
        position: [Math.cos(angle) * r, 0, Math.sin(angle) * r],
        timeOffset: i * stagger,
        seedOverride: i * 13 + 1,
      };
    });
  }, [count, spreadRadius, stagger]);

  return (
    <group position={position}>
      {stems.map(({ position: pos, timeOffset, seedOverride }, i) => (
        <ProceduralStem
          key={i}
          position={pos}
          timeOffset={timeOffset}
          seedOverride={seedOverride}
        />
      ))}
    </group>
  );
}
