# Flower field — anchor density layout

Chapter 3 "Still": an astronaut lying among flowers, gongbi / Chinese-painting
aesthetic. This directory owns **where flowers are, how big they are, when they
bloom, and how the arrangement changes over time.**

The governing rule, from the artist, applies to every change in here:

> The anchor system should make the layout feel intentional without making the
> system itself visible.

If a viewer can count the clusters and get the anchor count, or trace a continuous
band around the body, the system has become visible and the change is wrong
regardless of how good the density map looks.

---

## Pipeline

```
useCharacterBodyBounds ──► capsules + backpack box
        │
        ▼
deriveFieldAnchors      (fieldAnchors.js)    4 anchors: hip, hand.l, boot.l, backpack
        │                                     each = { x, z, radius, inner, weight, axis, elong }
        ▼
sampleAnchorField       (fieldAnchors.js)    (x,z) ──► 0..1 density. THE field.
        │                                     summed anchors, domain warp, presence
        │                                     mask, edge noise, BVH keep-out
        ▼
buildAnchorClusterSlots (fieldClusterLayout.js)  dispersal sampling ──► slot pool
        │                                     founders (rejection) ──► hops ──► spares
        ▼
buildStem               (PlantField.jsx)     per slot: size, height, role, bloomCeiling
        │
        ▼
PlantSystem             (PlantSystem.jsx)    merged tube geometry + VAT flower batches
                                             + per-plant DataTexture
```

`sampleAnchorField` is the single source of truth for density. The debug heat map
calls the *same function* the sampler does — never write a second copy of it.

### Two layout modes

`layoutMode` = `anchors` (live) or `spiral` (original golden-angle). Both call the
shared `buildStem`. The spiral branch is kept switchable but the A/B is **already
invalid** — the height/size split only exists in the anchor path, so the two
branches no longer differ by layout alone.

### Slot pool

`count` live slots plus `slotFactor - 1` spares each. A plant **hops between slots**
at respawn by writing DataTexture row 1 — the merged geometry is never rebuilt.

- **Live slots** are placed against the **true** field.
- **Spare slots** are placed against an **envelope** (anchor radius + `migrateDist`)
  and may sit up to `variantSpread` from their live point.

Getting that backwards puts live plants out in the margin where the field is zero,
which reads as a vague halo around every mass. It was survivable only while a gate
hid them; there is no gate now.

---

## Invariants — break these and something breaks silently

1. **Every flower completes its full lifecycle.** Never scale `stemGrow` or
   `flowerScale` by a field value. Composition logic may only act at respawn, when
   a plant is fully retracted (`stemGrow <= 0.001`). A density gate used to scale
   `stemGrow`; blooming flowers shrank back down when the field drifted off them,
   which read as growing in reverse, and it wasted ~45% of the built count on
   permanently dormant plants. Migration now steers *where the next flower
   appears*, never which live ones survive.

2. **`THREE.LineLoop` is unsupported by the WebGPU renderer.** Use `line` with the
   first point repeated. Every ring in `CompositionDebug` silently drew nothing and
   emitted one error per ring per frame (31,748 of them) before this was found.

3. **Leva keys are load-bearing; labels and folders are not.** `useControls`
   returns a **flat** object, so folders can be reorganised freely — but renaming a
   key breaks `PlantField`'s destructuring silently (you get `undefined`, not an
   error).

4. **A knob that does nothing in the current mode must be hidden**, via leva's
   `render` predicate — not parked in a folder. A folder may only be hidden
   wholesale when *every* member is mode-specific; `Evolution` and `Keep-out` are
   mixed and gate per input. Hiding a live control is the same bug as showing a
   dead one.

5. **Stem geometry is baked in plant-local space.** Placement lives in DataTexture
   row 1 (`[offsetX, offsetY, offsetZ, yaw]`), row 0 is
   `[stemGrow, swayX, swayZ, _]`. This is what makes runtime respawn free.

6. **Line endings.** Tracked files are CRLF, newly created files are LF. Any patch
   script must read with `newline=''`, normalise to `\n`, and write back the
   original EOL — otherwise every multi-line match fails.

7. **`groupKey` must be stamped on every slot, including spares.** `PlantSystem`
   buckets free slots by `slot.groupKey`; when it was only written onto live slots,
   every spare fell into bucket `-1` while every plant sought a bucket `>= 0`, and
   the reshuffle silently never fired.

---

## The sim clock

`../lifecycle/simSpeed.js` — a module-level ref, deliberately not a prop. The
field, `ClimbTendrils` and `ProceduralStem` each run their own `useFrame` and must
agree on how fast time passes.

- Scales lifecycle `dt` **and** the anchor-field drift. Both, on purpose: at 10x a
  render-clock drift would show six flower generations against a stationary field,
  which is the thing under review.
- Clamp **before** scaling — `Math.min(delta, 0.1) * speed`. The clamp stops a
  backgrounded tab skipping a cycle on refocus.
- Wind sway stays on `clock.elapsedTime`. It is ambient motion, not simulation
  state; at 10x it reads as a gale.
- Space (`useLifecyclePauseHotkey`) freezes `simTime`, so it freezes the drift too.

**Set `sim speed` to 10 for any evolution review.** One lifecycle is ~21–33s, so
180 real seconds is ~6 generations; at 10x that is 18s.

---

## Knobs worth knowing about

Full comments live in `fieldControls.js`. These are the ones that have misled
someone before:

| Knob | Trap |
|---|---|
| `size ramp radius` (`spreadRadius`) | A **size** control in `anchors` mode (→ `farR` → `rimT` → `sizeMul`), the **placement radius** in `spiral`. The only knob whose meaning changes between layouts. Clamps up to bodyDiagonal + 0.6, so lowering past ~1.8 does nothing. |
| `flower count` | Was inflated to 230 to offset the removed gate. Built count now equals visible count — **this is very likely too high and wants retuning down** (try 150–170). |
| `shape warp` | The only knob that makes a mass stop being an ellipse. `edge ragged` is multiplicative on the field *value*, so it can roughen an outline but never manufacture density on bare ground, and never changes the gross form. |
| `migrate range` | Also sizes the spare envelope **at build time**, so changing it rebuilds the slot pool. Was missing from the memo deps, which froze the envelope at its mount value. |
| `regrow floor` | Density floor for the respawn pick. Steers new growth; cannot cull a live plant. |
| `spare slots x` | At 1 the reshuffle has nowhere to go. |

**Removed, do not reintroduce without a reason:** `minGap` (misnamed — nothing
enforces flower separation; its only effect was silently raising the size ramp
radius), `anchorDrift` / `fieldX` / `fieldZ` (redundant with the migration walk,
and inert whenever `migrateDist > 0`), `negativeStrength` / `negativeMask` (the
hard `faceClearRadius` pocket is now the only helmet protection), `migrateBand`
(width of a fade that no longer exists).

---

## Verification — the build proves nothing

`npm run build` passed for a silently dead feature, a temporal-dead-zone error, and
an assignment-to-const in this session. **You must load the app and read the
console.**

1. `https://localhost:5173/debug` — **never** the root path, which opens on a
   narrative intro card.
2. Playwright from the repo's own `node_modules`, `channel: 'chrome'`, args
   `--enable-unsafe-webgpu --ignore-certificate-errors`, `ignoreHTTPSErrors: true`.
   Target `#root canvas` (stats-gl injects its own canvases). Hide leva and stats
   before screenshotting; prefer clipped regions over whole frames.
3. Check WebGPU is actually available (`navigator.gpu.requestAdapter()`), or a
   blank frame will read as a layout bug.
4. Grep the console for `pageerror` and for the `anchor layout short by N` warning
   after any sampler change.
5. **Two angles, every time** — one overhead, one grazing. The field is planar and
   reads completely differently from a low camera; this was verified from overhead
   only for a long time and the side view turned out to be a flat mat.

### Reading the density field

`Debug > density field` draws the field through `sampleAnchorField`. It shows the
**static** field — `anchorFieldOptions` carries no `centres` — so it will not move
under migration. Judge migration from the flowers, not the heat map.

`↳ as solid mask` is the mode for tuning `Mass Shape`. As a heat map, brightness
variation reads as shape variation and `shape warp` vs `edge ragged` are nearly
indistinguishable. As a solid mask at one threshold, only the outline is on screen:
warp deforms it, edge noise roughens it, bare patches hole it. Sweep `↳ threshold`
to walk the iso-contours. Drop `flower count` to ~40 so the flowers don't occlude
the mask.

---

## Known-open work

- **Macro masses.** The approved plan's step 3 is untouched: consolidate toward 2–4
  larger, softer masses with broken edges and interior voids, plus one small
  **distant echo mass** off the body. Offsets from the silhouette must be
  deliberately uneven — evenly distributed along the outline is exactly how the
  wreath comes back.
- **Migration has never been verified as evolution.** No time-lapse has been taken.
  Stills at 0 / 45 / 90 / 180 s from a fixed frame, diffed.
- **`flower count` retune** after the gate removal (see table above).
- **The leva `render` gating depends on the path `'Field.Layout.layoutMode'`.** Both
  predicates default to *visible* when `get()` returns undefined, so a wrong path
  shows everything rather than emptying the panel. If switching `layout` to
  `spiral` does not hide `Mass Shape`, that path is wrong — one-line fix.
- **Side view / height rhythm** (plan step 4). `HEIGHT_MIN/MAX/BIAS` in
  `PlantField.jsx` separate stem height from head size; whether that is enough has
  not been judged from a grazing camera.

## Files

| File | Role |
|---|---|
| `fieldAnchors.js` | Anchor derivation, `sampleAnchorField`, domain warp, presence mask, `animatedCentre` |
| `fieldClusterLayout.js` | Dispersal slot sampling: founders, hops, spares |
| `PlantField.jsx` | Leva wiring, both layout branches, `buildStem`, role classification |
| `PlantSystem.jsx` | Merged geometry, DataTexture, lifecycle stepping, field-weighted respawn |
| `CompositionDebug.jsx` | Anchor rings, density grid / solid mask, composition guides |
| `bodyBounds.js` | BVH keep-out: `clearPointFromHosts`, `clearPointFromDisc` |
| `fieldControls.js` | Leva schema — grouping and mode gating |
| `fieldDefaults.js` | Default values with rationale |
| `../lifecycle/simSpeed.js` | Global sim rate shared across all plant systems |
