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
buildAnchorClusterSlots (fieldClusterLayout.js)  dispersal sampling ──► live slots
        │                                     founders (rejection) ──► hops
        ▼
buildStem               (PlantField.jsx)     per slot: size, height, role, bloomCeiling
        │
        ▼
PlantSystem             (PlantSystem.jsx)    merged tube geometry + VAT flower batches
                                             + per-plant DataTexture
```

`sampleAnchorField` is the single source of truth for density. The debug heat map
calls the *same function* the sampler does — never write a second copy of it.

Layout is **always** the anchor field. The golden-angle spiral branch and its
knobs (`layoutMode`, `positionJitter`, `contactPow`) were removed; do not
reintroduce a second layout without a reason.

### Respawn

Hearts (one per opening founder) **wander on their own clock** — a field-weighted
creep of up to `migrateRange`, staggered so they do not jump together. A plant
that finishes its cycle **picks among current hearts** with
`P ∝ field(heart) × exp(-dist / attractRadius)`, then hops around the chosen
heart. Occupancy follows likelihood; live plants are never moved. Geometry is
never rebuilt; DataTexture row 1 takes the new offset.

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

3. **Leva keys are the names on screen.** There is no separate `label`.
   `useControls` returns a **flat** object, so folders can be reorganised freely —
   but renaming a key breaks `PlantField`'s destructuring silently (you get
   `undefined`, not an error).

4. **A knob that does nothing right now must be hidden**, via leva's `render`
   predicate — not parked in a folder. A folder may only be hidden wholesale when
   *every* member is unused; otherwise gate per input. Hiding a live control is
   the same bug as showing a dead one.

5. **Stem geometry is baked in plant-local space.** Placement lives in DataTexture
   row 1 (`[offsetX, offsetY, offsetZ, yaw]`), row 0 is
   `[stemGrow, swayX, swayZ, _]`. This is what makes runtime respawn free.

6. **Line endings.** Tracked files are CRLF, newly created files are LF. Any patch
   script must read with `newline=''`, normalise to `\n`, and write back the
   original EOL — otherwise every multi-line match fails.

7. **Respawn picks a heart, then hops.** Hearts move on a timer, independent of
   flower deaths. The pick is field × distance so neighbourhood occupancy can
   follow the heatmap without everyone piling on the hottest heart. If a hop
   fails, the plant stays put for that generation rather than landing on empty
   ground.

---

## The sim clock

`../lifecycle/simSpeed.js` — a module-level ref, deliberately not a prop. The
Leva control lives on the **Sim** panel, not Field: it also drives
`ClimbTendrils` and `ProceduralStem`. The field, climbers and standalone stems
each run their own `useFrame` and must agree on how fast time passes.

- Scales lifecycle `dt` **and** the anchor-field drift. Both, on purpose: at 10x a
  render-clock drift would show six flower generations against a stationary field,
  which is the thing under review.
- Clamp **before** scaling — `Math.min(delta, 0.1) * speed`. The clamp stops a
  backgrounded tab skipping a cycle on refocus.
- Wind sway stays on `clock.elapsedTime`. It is ambient motion, not simulation
  state; at 10x it reads as a gale.
- Space (`useLifecyclePauseHotkey`) freezes `simTime`, so it freezes the drift too.

**Set Sim `simSpeed` to 10 for any evolution review.** One lifecycle is ~21–33s, so
180 real seconds is ~6 generations; at 10x that is 18s.

---

## Knobs worth knowing about

Full comments live in `fieldControls.js`. These are the ones that have misled
someone before:

| Knob | Trap |
|---|---|
| `flowerCount` | Was inflated to 230 to offset the removed gate. Built count now equals visible count — **this is very likely too high and wants retuning down** (try 150–170). |
| `shapeWarp` | The only knob that makes a mass stop being an ellipse. |
| `migrateRange` | How far a heart may creep on each periodic hop. 0 freezes hearts; dying flowers still pick among them. |

**Removed, do not reintroduce without a reason:** `compositionGuides` (debug
rings + role size legend; face pocket is on `showAnchors`), `regrowFloor` (hard density
cut; accept/pick are already `P ∝ field`), `nearBloomScale` /
`sizeRampRadius` (radial size ramp from body centre; fought clump-core size),
`edgeRagged` / `edgeScale`
(multiplicative brightness noise on an unchanged outline; shape comes from
`shapeWarp`), `reshuffleOnRespawn` /
`spareSlots` (nearby pre-baked hops; respawn now samples the live field),
`layoutMode` / `positionJitter` /
`contactPow` (golden-angle spiral layout and its knobs), `minGap` (misnamed —
nothing enforces flower separation; its only effect was silently raising the size
ramp radius), `anchorDrift` / `fieldX` / `fieldZ` (redundant with the migration
walk, and inert whenever `migrateRange > 0`), `negativeStrength` / `negativeMask`
(the hard `faceClearRadius` pocket is now the only helmet protection),
`migrateBand` (width of a fade that no longer exists).

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

`Debug > densityField` draws the field through `sampleAnchorField`. It shows the
**static** field — `anchorFieldOptions` carries no `centres` — so it will not move
under migration. Judge migration from the flowers, not the heat map. Drop
`flowerCount` if the flowers occlude the overlay.

---

## Known-open work

- **Macro masses.** The approved plan's step 3 is untouched: consolidate toward 2–4
  larger, softer masses with broken edges and interior voids, plus one small
  **distant echo mass** off the body. Offsets from the silhouette must be
  deliberately uneven — evenly distributed along the outline is exactly how the
  wreath comes back.
- **Migration has never been verified as evolution.** No time-lapse has been taken.
  Stills at 0 / 45 / 90 / 180 s from a fixed frame, diffed.
- **`flowerCount` retune** after the gate removal (see table above).
- **Side view / height rhythm** (plan step 4). Field length is `stemLength`
  sampled with `lengthExp` so most stems sit near min. Whether that is enough
  has not been judged from a grazing camera.

## Files

| File | Role |
|---|---|
| `fieldAnchors.js` | Anchor derivation, `sampleAnchorField`, domain warp, presence mask, `animatedCentre` |
| `fieldClusterLayout.js` | Dispersal slot sampling: founders, hops; heart pick + hop on respawn |
| `PlantField.jsx` | Leva wiring, slot build, `buildStem`, role classification |
| `PlantSystem.jsx` | Merged geometry, DataTexture, lifecycle stepping, periodic hearts, death-time pick |
| `CompositionDebug.jsx` | Anchor rings, density heat grid, composition guides |
| `bodyBounds.js` | BVH keep-out: `clearPointFromHosts`, `clearPointFromDisc` |
| `fieldControls.js` | Leva schema — grouping and unused-knob gating |
| `fieldDefaults.js` | Default values with rationale |
| `../lifecycle/simSpeed.js` | Global sim rate shared across all plant systems |
