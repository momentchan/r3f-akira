# Ground Trees and Ground Flowers

This document is the handoff for the ground-growth system used around the
character and backpack. Read it before changing `GroundTendrils`, the ground
mode of `PlantField`, or their shared lifecycle.

## Visual intent

The system should communicate a causal sequence:

1. Tendrils originate on real character/backpack mesh surfaces where those
   meshes contact the ground.
2. A small number of long trees establish the main composition.
3. More short nearby trees create local density around the two hosts.
4. Flowers grow only from those ground routes.
5. Flowers form several lush clusters (`花團錦簇`), with sparse flowers between
   them, rather than an even line or an all-direction radial explosion.
6. The composition must retain meaningful negative space.

Body and backpack are both narrative growth sources. Do not replace this with
unrelated flowers scattered over the ground, and do not connect separate hosts
with unsupported tendrils crossing through the air.

## Runtime ownership and data flow

`ExperienceCanvas.jsx` owns the bridge between the two render systems:

```text
Character / Backpack bounds
            |
            v
      GroundTendrils
       |           |
       | paths     | lifecycle + regenerated-route refs
       v           v
        PlantField -> PlantSystem
```

The shared values are:

- `groundPaths`: initial path array passed from `GroundTendrils` to
  `PlantField`.
- `groundCompletedTreesRef: Set<logicalTreeId>`: trees currently allowed to
  grow flowers.
- `groundTreeLifecycleRef: Map<logicalTreeId, state>`: current tree phase,
  generation, and flower-phase age.
- `groundFlowerTimingRef`: longest measured flower duration per tree. Ground
  trees use it to know how long to remain alive.
- `groundRouteRegistryRef: Map<logicalPathId, path>`: latest regenerated curve
  for each logical route. Flowers use it to follow a route after resampling.
- `groundOffsetY`: one live group offset shared by tendrils and flowers so
  their roots remain aligned.

These refs intentionally avoid React rerenders on every lifecycle frame.

## Ground-tree construction

Source: `buildGroundTrees.js`.

### Host roots

`footprintRoot()` scans the host geometry's position attribute and chooses a
real mesh vertex in the requested angular sector:

- First choice: a vertex within `contactBand` of `y = 0`.
- Fallback: a vertex within the same band of the mesh's lowest surface.
- Direction alignment dominates radial distance so one long limb cannot steal
  every root.
- The first point stays on the host contact. Later curve points settle onto the
  ground.

The curve centreline is raised by its local tube radius. With `groundGap = 0`,
the tube's lower surface—not its centreline—touches `y = 0`. Runtime ground-gap
adjustment is applied to the entire tendril and flower groups together.

### Tree layout

Current defaults:

| Host | Main trees | Nearby trees | Length scale |
| --- | ---: | ---: | ---: |
| Body | 4 | 6 | 1.0 |
| Backpack | 3 | 4 | 0.82 |

- Main trees use the partial `directionCenter` / `directionSpread` fan.
- Nearby trees are shorter (`shortTreeLengthScale = 0.34`) and use a wider
  directional spread.
- Routes are six-point centripetal `CatmullRomCurve3` curves.
- Children attach around 42–76% along their parent, with deterministic jitter.
- Child target direction is radial from the host, while its initial tangent is
  inherited from the parent. This preserves a tree-like flow.
- Child radius exactly matches the parent's local radius at the joint, then
  decays by `radiusDecay` toward its own tip.

### Logical graph versus rendered traces

The complete procedural graph is intentionally larger than the visible mesh.
Every path remains available to flower sampling, lifecycle distance, and the
regenerated-route registry, but each logical tree receives a stable
`groundRole`:

- `hero`: principal long tree. Render its trunk and one deterministic depth-1
  branch.
- `nearby`: short local tree. Render only its trunk.
- `guide`: keep all paths logical-only; do not pack them into the visible mesh.

Current default allocation:

| Host | Hero trees | Visible nearby trees |
| --- | ---: | ---: |
| Body | 3 | 4 |
| Backpack | 2 | 3 |

With the default branch settings this produces 135 logical paths but only 17
rendered paths: 5 hero trunks, 5 hero depth-1 branches, and 7 nearby trunks.
This separation is the hybrid art direction: retain causal growth structure
without showing a horizontal procedural skeleton under every flower.

Ground debug colors are role-based: cyan = hero, yellow = nearby, translucent
magenta = hidden guide.

### Stable identity

The following IDs are contracts, not cosmetic labels:

- `logicalTreeId`: stable across lifecycle generations.
- `logicalPathId`: stable path/topology address within a logical tree.
- `treeId`: currently equal to `logicalTreeId`.
- `routeGeneration`: changes when a tree completes a full lifecycle.

Dynamic route replacement assumes every generation has identical path topology
and vertex counts. Changing tree count, branch depth, children per parent, or
tube segmentation requires a full geometry rebuild.

`GroundTendrils.jsx` must publish all paths to `PlantField` and update all paths
in `groundRouteRegistryRef`, while packing and buffer-patching only paths whose
`renderGroundTendril` flag is true. Filtering the public path array would make
flowers disappear from hidden guide routes.

## Ground roles and flower hierarchy

The former poetic route personalities were removed. The explicit `groundRole`
now controls both visibility hierarchy and per-tree flower allocation:

| Role | Default flowers/tree | Relative flower size |
| --- | ---: | ---: |
| Hero | 7–9 | 1.0 |
| Nearby | 3–4 | 0.82 |
| Guide | 1–2 | 0.72 |

With the current 17 logical trees and requested count of 80, allocation is
approximately 45 hero flowers, 28 nearby flowers, and 7 guide flowers. Every
logical tree receives at least one flower whenever the requested count is at
least the logical-tree count.

## Ground-flower layout

Source: `buildGroundFlowerStems.js`, called by the ground-path branch of
`PlantField.jsx`.

### Eligible routes and weight

Flowers currently sample route depths 0 and 1 only. Each eligible route gets:

```text
weight = curve length
       * (1.6 for a depth-0 trunk, otherwise 1.0)
```

Every accepted root is an exact `curve.getPointAt(t)` position. Never move a
flower root away from its source tendril just to make the crown wider.

### Bloom clusters

Current defaults:

- Requested flowers: `80` (an upper bound, not a guaranteed count).
- Root gap: `0.14` in XZ, checked globally across accepted roots.
- Flowers in clusters: `0.75`.
- Route sample range: `t = 0.18 ... 0.92`.

Cluster creation:

1. Group eligible paths by `logicalTreeId`.
2. Give every tree a deterministic cluster centre on its trunk.
3. Allocate the requested count by role minima and maxima before distributing
   overflow, biased toward hero trees.
4. Use a wider cluster span for hero trees and smaller spans for nearby/guide
   trees.
5. Sample about 75% of each tree's candidates near its centre; sample the
   remaining 25% from that tree's complete eligible path set.
6. Hero and nearby clusters use a slightly tighter role-specific local gap to
   create bouquets without changing the global root-gap control.

`minGap` rejection and the finite attempt budget mean the actual accepted count
can be lower than the requested count, especially where routes overlap.

### Turning a route into an area

Roots remain one-dimensional, but stems fan to both sides of the route tangent:

- `flowerBandSpread = 0` restores tangent-aligned rows.
- Current default `0.78` applies a deterministic left/right fan.
- Fan azimuth is roughly 58–122 degrees from the route tangent before the
  strength multiplier.
- The same strength increases lean and bend, turning the flower crowns into a
  band without detaching their roots.
- `routeFanOffset` is stored per flower and reapplied after route regeneration.

Stem base radius inherits the source branch's local tapered radius, with only a
restrained variation from the shared Stem controls. This makes ground tree and
flower stem read as one organism.

### Height and posture hierarchy

Ground flowers do not share one height or one lean profile. Each accepted
flower receives two deterministic attributes that remain stable until the
layout seed changes:

- `stemPosture`: `short`, `medium`, or `tall`.
- `leanStyle`: `upright`, `soft`, or `expressive`.

Posture is weighted by ground role so hero routes create the vertical skyline
while nearby and guide routes fill the lower volume:

| Role | Short | Medium | Tall |
| --- | ---: | ---: | ---: |
| Hero | 12% | 57% | 31% |
| Nearby | 42% | 48% | 10% |
| Guide | 50% | 43% | 7% |

The posture selects a subrange of the shared Stem Length range: short uses the
lower 38%, medium spans roughly 30-78%, and tall uses the upper 32%. A small
0.94-1.06 multiplier prevents hard height shelves.

Lean style is independent of height: approximately 65% upright, 25% soft, and
10% expressive. It scales route fan, lean, and bend rather than inventing a
new root position. The result should read as a flower region from a side view,
not as one straight row and not as an evenly filled field.

### Flower species

Ground flowers currently use only Dahlia and Rose:

- `roseRatio = 0.45` means approximately 45% Rose and 55% Dahlia.
- A seeded low-discrepancy sequence keeps the accepted population close to the
  target ratio even when spatial candidates are rejected.
- Ground roles do not override the species ratio.
- Flower type remains stable when a route regenerates.

Plumera is currently used by body/backpack climb tendrils. Jasmine and Plumera
are registered flower types, but neither is sampled by the ground flower field.

## Coordinated lifecycle

Ground trees and flowers share the lifecycle helpers in
`plants/lifecycle/plantLifecycle` and the same Space-key pause state.

Each logical tree independently runs:

```text
initial delay -> parent-to-child ground growth -> flowers -> ground retraction
      -> generation increment -> route resample -> repeat
```

Important behavior:

- Initial tree age is negative by a deterministic amount up to
  `initialStartSpread = 28s`, preventing all trees from popping in together.
- Tree growth uses cumulative path distances, so parents become visible before
  children.
- A tree enters `flowers` after its ground growth completes.
- Only flowers whose `sourceTreeId` matches that tree may advance.
- The tree remains grown for the longest complete flower lifecycle assigned to
  it, received through `groundFlowerTimingRef`.
- It retracts only after those flowers finish.
- At zero growth, generation increments and the route is deterministically
  resampled from `layoutSeed + generation * generationSeedStep`.
- Each flower retains its `logicalPathId` and `sourcePathT`, moves to the newly
  registered curve, and restarts with a generation-specific lifecycle seed.

The cluster membership and species do not currently reroll independently.
Regeneration changes the path geometry, so the same logical flower attachment
does move spatially, but it stays on the same logical route at the same `t`.

## Geometry and performance

Ground tendrils:

- One packed mesh and one plant-data texture.
- The default layout keeps 135 logical paths for flower attachment and
  lifecycle routing, but packs only 17 visible paths. This removes about 87%
  of the ground-tendril tube paths from rendering without deleting their
  composition data.
- GPU growth animation.
- Current internal geometry: 48 longitudinal segments and 5 radial segments.
- On route regeneration, only `position`, `normal`, `center`,
  `previousPosition`, and `previousCenter` buffer ranges are patched in place.
- The mesh, material, pipeline, and React tree are not recreated each cycle.

Flowers:

- Stem tubes are merged into one geometry.
- Runtime placement and growth use a two-row data texture per plant.
- Flower heads are VAT-instanced and batched by flower type.
- Leaves use the shared field-leaf system.

The current design assumes the character and backpack remain still. Supporting
moving/deforming hosts would require updating contact/root transforms and is
outside the present scope.

## Controls and rebuild behavior

### Ground Tendrils panel

Geometry/layout controls rebuild after a 100 ms debounce:

- Host tree counts
- Main direction and spread
- Tree lengths and curvature
- Branching structure
- Tendril radius and taper

Live controls do not rebuild the route topology:

- Enabled/debug visibility
- Lifecycle timings
- Extra ground gap (shared group offset)

### Field panel in ground mode

Relevant arrangement controls:

- `flower count`
- `accepted flowers` (read-only; the actual count after spacing rejection)
- `flower root gap`
- `lean outward`
- `flower band width`
- `flowers in clusters`
- `rose ratio`
- `seed`

`spreadRadius`, `positionJitter`, surround/BVH controls, respawn slot factor,
and free-ground reshuffling belong to the legacy non-ground field path. They do
not determine the ground-route flower layout. Be careful when cleaning the UI:
`groundPaths = []` means ground mode is loading and must not fall back to the
legacy free-ground layout; only `groundPaths = null` selects that old mode.

Stem geometry controls affect generated flower stems. Flower look/color ranges
are applied through the per-type flower batches; color changes do not require a
stem layout rebuild.

## Key files

| File | Responsibility |
| --- | --- |
| `app/ExperienceCanvas.jsx` | Owns shared state/refs and wires both systems. |
| `groundTendrils/GroundTendrils.jsx` | Render system, tree lifecycle, route regeneration, GPU buffer patching. |
| `groundTendrils/buildGroundTrees.js` | Host contact extraction and parent/child curve construction. |
| `groundTendrils/buildGroundFlowerStems.js` | Route weighting, cluster sampling, species, fan direction, inherited stem parameters. |
| `groundTendrils/groundTendrilDefaults.js` | Host visibility profiles and geometry/lifecycle defaults. |
| `groundTendrils/groundTendrilControls.js` | Ground Tendrils Leva schema. |
| `groundTendrils/GroundTendrilDebug.jsx` | Tree/path debug rendering. |
| `field/PlantField.jsx` | Chooses ground-route mode and publishes per-tree flower timings. |
| `field/PlantSystem.jsx` | Merged stems, VAT heads, flower lifecycle, regenerated-route attachment. |
| `field/fieldDefaults.js` | Flower count, cluster, species, and lifecycle defaults. |
| `tendrils/treeTendrilSystem.js` | Shared packed tree geometry and parent-to-child growth utilities. |
| `lifecycle/plantLifecycle.js` | Shared deterministic lifecycle calculations. |

## Invariants for future changes

1. Every ground tree root comes from a real host contact candidate.
2. Ground tube lower surfaces and flower roots share the same ground offset.
3. Every ground flower root has a valid `sourceTreeId`, `sourcePathId`, and
   `sourcePathT` and remains on that route.
4. Parent branches grow before children and retract after children.
5. A tree waits for its own flowers, not a global field timer.
6. Lifecycle resampling happens while geometry is fully retracted; never expose
   a buffer swap as a visible pop or flicker.
7. Logical path topology remains stable across dynamic generations.
8. Ground role controls per-tree density and scale, while global species mix
   remains understandable and directly controllable.
9. Preserve asymmetric main paths, nearby short paths, bloom clusters, and
   negative space. More count alone is not a composition strategy.
10. Visibility is not eligibility: hiding a guide path must never remove it
    from flower sampling, lifecycle timing, or route regeneration.

## Verification checklist

After changing this system:

1. Run `npm run build`.
2. With Ground Tendrils debug enabled, verify roots begin on the body/backpack
   contact surfaces and all child junctions meet their parents.
3. Inspect at grazing angle: tendril tubes should touch the ground without a
   visible gap from their shadows.
4. Verify flower stems begin exactly on their source curves: visible for
   hero/nearby routes and translucent magenta in debug for guide routes.
5. Confirm body and backpack both receive clusters and the requested flower
   count is not being heavily reduced by `minGap`.
6. Watch at least one full cycle: ground growth, flowers, flower death, ground
   retraction, and a non-flickering regenerated route.
7. Press Space and confirm ground trees, field flowers, and other shared plant
   lifecycles pause/resume together.
8. Check that the composition reads as a few principal growth paths with lush
   clusters and open space—not an even radial pattern.

## Current checkpoint

The five hybrid-layout milestones are implemented:

1. Keep the full procedural graph, but render only the curated hero and nearby
   traces.
2. Allocate flowers per logical tree and ground role, with a stable global
   Dahlia/Rose ratio.
3. Add deterministic short/medium/tall posture and restrained lean styles for
   top- and side-view volume.
4. Coordinate each tree and its flowers through parent-to-child growth,
   flower hold, child-to-parent retraction, and hidden route resampling.
5. Reduce the ground-mode Field panel to meaningful controls and expose the
   actual accepted flower count.

The default system keeps 135 logical paths, renders 17 hero/nearby traces, and
gives every one of the 17 logical trees a flower budget. The current flower
checkpoint is `80 / 0.75` (requested flowers / cluster share) with a stable 55%
Dahlia / 45% Rose target.

Deterministic zero-gap layout verification accepts all 80 requested stems,
flowers all 17 trees, allocates 45/28/7 stems to hero/nearby/guide, and produces
15/45/20 short/medium/tall stems for the tested seed. With the authored root
gap and overlapping real routes, the accepted count may be slightly lower and
is shown live in Leva.

Lifecycle verification confirms that the parent interval becomes visible
before the child interval, the child retracts while the parent remains, and the
parent retracts last. Production build passes. Final top/side runtime review is
still an art-direction check rather than a structural milestone.

