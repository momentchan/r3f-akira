import { VatFlower } from './VatFlower';
import { FLOWER_META, STEM_Y_MAX } from './config';

// Dahlia tip flower — shared VatFlower with the Dahlia asset defaults.
// Material look comes from the parent (ProceduralStem) via uniforms / "Dahlia" Leva.
export function DahliaVAT(props) {
  return (
    <VatFlower
      metaUrl={FLOWER_META}
      stemYMax={STEM_Y_MAX}
      {...props}
    />
  );
}
