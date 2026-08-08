import { VatFlower } from './VatFlower';
import { ROSE_META, STEM_Y_MAX } from './config';

// Rose tip flower — same VAT pipeline as Dahlia, different assets.
// Material look comes from the parent via uniforms / "Rose" Leva panel.
export function RoseVAT(props) {
  return (
    <VatFlower
      metaUrl={ROSE_META}
      stemYMax={STEM_Y_MAX}
      {...props}
    />
  );
}
