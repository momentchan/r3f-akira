<!--
Codrops title / subtitle (paste into the post header, not as H1 in the body):

Title: Still: A Cartoon Print Look and a Generative Garden in WebGPU
Subtitle: Building chapter 3 of an interactive astronaut series — quantized toon shading, ink shadows, and plants that bloom around a resting figure, then climb it.

Tags: case study, Three.js, TSL, WebGPU, procedural, toon
-->

<!-- wp:video -->
<figure class="wp-block-video"><!-- [VIDEO: Still hero reel — lying astronaut, flower masses, tendrils, slow camera] --></figure>
<!-- /wp:video -->

<!-- wp:paragraph -->
<p><a href="DEMO_URL">Live Demo</a></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><a href="https://github.com/momentchan/r3f-akira">Source Code</a></p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Intro</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p><em>Still</em> is an interactive WebGPU project and chapter 3 of a series I have been building on the web. Same astronaut. Each chapter expands the story a little, and tries a new visual expression.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>In <em><a href="https://drift-co0.pages.dev/">Drift</a></em>, he is lost in space, drifting, longing to return home. An AI-generated diary holds the loneliness and the memories of his family.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>In <em><a href="https://tympanus.net/codrops/2026/04/21/false-earth-from-webgl-limits-to-a-webgpu-driven-world/">False Earth</a></em>, he has landed. The grass never ends. Cosmic beams fall when he moves. Flowers bloom and die in seconds. He keeps running.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>Now he is tired. He lies down. The horizon stays where it has always been. Flowers open around him and scatter their petals. Tendrils find the orange suit and start to cross it. The rest of this chapter’s plot is still open. The setting is not: rest, and life growing over a body that has finally stopped.</p>
<!-- /wp:paragraph -->

<!-- wp:image -->
<figure class="wp-block-image"><!-- [IMAGE: the chapter tableau — flower masses around him, tendrils across the suit] --></figure>
<!-- /wp:image -->

<!-- wp:paragraph -->
<p>Technically, this chapter is two experiments. Can a <strong>cartoon / print look</strong> live in a browser — the graphic punch of Japanese anime, and the flat color of traditional Japanese print? And can a <strong>generative garden</strong> bloom around a resting figure, then wrap him, without me placing every vine by hand?</p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading">The Look</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Grass was the soul of <em>False Earth</em>. Here the soul is the picture language. I wanted that hard anime graphic on the web. <em>Akira</em> was the loud reference — orange, outline, few steps of color. When I looked longer, traditional Japanese print had the same habits: flat fields, a dirty paper, an edge that is drawn, not photographed. That is why the suit is quantized and outlined. It is not PBR.</p>
<!-- /wp:paragraph -->

<!-- wp:image -->
<figure class="wp-block-image"><!-- [IMAGE: inspiration refs — anime graphic / Akira energy; traditional print or woodblock] --></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>Quantized Lighting</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>The astronaut and the backpack share one woodblock toon. I remap N·L through a soft window (<code>thresholdLow</code> / <code>thresholdHigh</code>), then <code>floor</code> it into a few <strong>color levels</strong>. Shadow and highlight are tints mixed on the albedo — not a realistic light response.</p>
<!-- /wp:paragraph -->

<!-- wp:code -->
<pre class="wp-block-code"><code>const ndl = max(dot(N, L), 0.0);
const preShade = clamp(
  ndl.sub(thresholdLow).div(thresholdHigh.sub(thresholdLow)),
  0.0,
  1.0,
);
const quantized = floor(preShade.mul(colorLevels.sub(1.0)).add(0.5))
  .div(colorLevels.sub(1.0));

const litColor = mix(
  albedo.mul(shadowTint),
  albedo.mul(highlightTint),
  quantized,
);</code></pre>
<!-- /wp:code -->

<!-- wp:paragraph -->
<p>Cast shadow is merged into that same quantized step, not multiplied on top. An area already at the shadow floor stays there. Only lit bands get pulled down. That keeps the print from going muddy.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>Inverted-Hull Outline</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>The white halo is a second mesh, back-face, pushed out along the normal. Same trick as a lot of toon games. On this suit it reads as a sketch line, not a glow.</p>
<!-- /wp:paragraph -->

<!-- wp:code -->
<pre class="wp-block-code"><code>material.side = THREE.BackSide;
material.positionNode = positionLocal.add(
  normalLocal.normalize().mul(outlineWidth),
);</code></pre>
<!-- /wp:code -->

<!-- wp:image -->
<figure class="wp-block-image"><!-- [IMAGE: suit close-up — quantized bands + inverted-hull outline] --></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>Stylish Ground Shadow</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>A photoreal contact shadow would fight the print. The ground is the same beige as the sky, so the plane has no edge. On that paper I still need a stain under him.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>I sample the directional <code>shadow()</code>, then treat the mask like ink: a noisy <strong>wash</strong> (spread, warp, fractal noise) and a darker <strong>contour</strong> along the silhouette (<code>fwidth</code> plus a little edge noise). The blob is drawn, not rendered as CG.</p>
<!-- /wp:paragraph -->

<!-- wp:code -->
<pre class="wp-block-code"><code>const amt = shadow(light).oneMinus();
const ink = fbm2(positionWorld.xz.mul(washScale));
const fill = smoothstep(spread, spread.add(edgeSoft), amt.add(ink.mul(edgeWarp)));
const wash = fill.mul(float(1.0).sub(ink.mul(washNoise).max(0.0)));

const w = fwidth(amt).mul(contourWidth).max(0.0001);
const edge = float(1.0).sub(smoothstep(0.0, w, amt.sub(edgeAt).abs()));
const shColor = mix(washColor, contourColor, edge);
return mix(bg, shColor, max(wash.mul(washStr), edge.mul(contourStr)));</code></pre>
<!-- /wp:code -->

<!-- wp:image -->
<figure class="wp-block-image"><!-- [IMAGE: stylish ground shadow — ink wash + contour, not a soft PCF blob] --></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>Plant Shadows on the Suit</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Flowers should fall on the orange fabric. If I use the same shadow map as the character, he shadows himself and the print dies. A second, plant-only light writes a map that contains plants and not the body. The toon shader reads that map. One extra pass. The picture stays graphic.</p>
<!-- /wp:paragraph -->

<!-- wp:image -->
<figure class="wp-block-image"><!-- [IMAGE: flowers casting on the suit] --></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>Contact Dirt</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>The boots and backpack need to look like they have been on the ground, without a hard CG stripe. I bake a vertex mask from height above the shared ground plane, with a little deterministic noise on the boundary. The dirt texture is quantized like the lighting, and mixed only in shadow and near contact. It does not depend on the plants.</p>
<!-- /wp:paragraph -->

<!-- wp:image -->
<figure class="wp-block-image"><!-- [IMAGE: ground contact dirt on boots / backpack] --></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>Silk Canvas</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Last, the whole frame is paper. A fullscreen pass lays a warp/weft weave, a warm tint, and blotch stains over the scene. Turn it off and you are looking at a 3D viewport again. Turn it on and the beige world holds together as a print.</p>
<!-- /wp:paragraph -->

<!-- wp:code -->
<pre class="wp-block-code"><code>const warp = pow(abs(sin(x.mul(PI))), sharpness);
const weft = pow(abs(sin(y.mul(PI))), sharpness);
const weave = mix(warp, weft, mod(floor(x).add(floor(y)), 2.0));
const fabric = float(1.0).sub(strength.mul(float(1.0).sub(weave)));
const overlaid = sceneColor.mul(tint).mul(fabric).mul(blotch);</code></pre>
<!-- /wp:code -->

<!-- wp:video -->
<figure class="wp-block-video"><!-- [VIDEO or IMAGE pair: silk-weave post off vs on] --></figure>
<!-- /wp:video -->

<!-- wp:paragraph -->
<p>Flowers and stems use the same quantized levels and tints. Petals get veins as ink strokes and a mask edge. Stems get a view-facing edge, not a hull outline. One art direction.</p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading">The Field</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>What you see first is not the vines. It is the garden around him.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>VAT flowers already existed in <em>False Earth</em> — bloom and die baked into a texture, replayed on the GPU. I did not want another infinite plane. I wanted masses that feel placed next to a lying body, without looking arranged.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>The rule I kept writing down: the system should feel intentional without becoming visible. If you can count the clusters and get four, the layout failed. A wreath around the silhouette failed the same way.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>Four Anchors</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>I derive four anchors from the posed body and the backpack: <strong>hip</strong>, <strong>left hand</strong>, <strong>left boot</strong>, <strong>backpack</strong>. An anchor does not mean a flower grows there. It raises the probability of vegetation in the neighbourhood. The cluster centre is allowed to drift off. Neighbouring fields merge. Bare ground survives between them.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>The Density Field</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Each anchor is an elongated falloff, not a circle. I sum them, warp the sample point so the blobs are irregular, punch <strong>bare patches</strong>, then run a hard MeshBVH keep-out so stems never sit inside the suit. The body is a star shape. A circular hole cannot carve that. Closest-point distance can.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>Founders and Hops</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Placement is not a golden-angle spiral. A few <strong>founders</strong> land by rejection against the field. Offspring <strong>hop</strong> from there; hop length decays with generation. A handful of scene-wide primaries stay large. The fringe stays buds. Dense core, thin edge — like a real thicket, not a decorator ring.</p>
<!-- /wp:paragraph -->

<!-- wp:image -->
<figure class="wp-block-image"><!-- [IMAGE: wide — masses at hip / hand / boot / backpack, not a ring] --></figure>
<!-- /wp:image -->

<!-- wp:image -->
<figure class="wp-block-image"><!-- [IMAGE optional: debug density field vs the same frame with flowers] --></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>Packed Stems</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Each plant is a procedural tube — taper, flare, lean — plus instanced leaves. The VAT head sits on the tip. Stems are packed into one draw, same instinct as instancing the grass in <em>False Earth</em>. I do not submit a hundred separate meshes.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>Each plant’s <strong>data package</strong> includes:</p>
<!-- /wp:paragraph -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li><strong>Seed and type</strong>: Dahlia or rose, plus color variation.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Anchor and clump</strong>: Which mass it belongs to, and how deep in the hop chain.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Field value</strong>: Density at the slot — used as a bloom ceiling, not to shrink a living flower.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Stem shape</strong>: Length, radius, taper, flare, lean.</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>VAT Blooms, Again</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>The petal motion is not mine. It comes from the <a href="https://superhivemarket.com/products/blooming-flowers---geo-nodes-curve-asset-pack">Blooming Flowers – Geo Nodes Curve Asset Pack</a> in Blender. Dahlia and rose (what you see in the field) are baked from that bloom cycle into position and normal textures. A Geo Nodes flower is too expensive to instance hundreds of times in the browser. VAT lets me replay it on the GPU. My work is the bake, the surround of the body, and the print look — not claiming I authored the animation.</p>
<!-- /wp:paragraph -->

<!-- wp:image -->
<figure class="wp-block-image"><!-- [IMAGE or VIDEO: Blender Geo Nodes bloom vs the same flower in the scene] --></figure>
<!-- /wp:image -->

<!-- wp:paragraph -->
<p>The clock is the same four stages as <em>False Earth</em>: <strong>Delay, Grow, Keep, Die</strong>. Readers of that article already know this machine. The new part of death is <strong>petal shed</strong>. Each petal shrinks toward its own centre and lifts, so the head comes apart instead of the whole flower scaling down. Then the stem retracts.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>When a plant finishes, it is not rebuilt. A clump <strong>heart</strong> has been wandering slowly. The dead plant picks among current hearts and hops. Live flowers are never yanked. Occupancy follows the field; geometry stays. The garden keeps changing while he stays still.</p>
<!-- /wp:paragraph -->

<!-- wp:video -->
<figure class="wp-block-video"><!-- [VIDEO: bloom → petal shed → hop elsewhere] --></figure>
<!-- /wp:video -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>LOD on Mobile</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Nearby heads use the high VAT. Far heads use a low-poly bake. On desktop Blink, a compute pass plus <strong>indirect draw</strong> picks the band — same idea as the grass LOD in <em>False Earth</em>. On iPhone, that path double-filled both meshes and the flowers flickered. WebKit still does not like that atomic compact. I compact the visible list on the CPU and set <code>mesh.count</code>. It is not elegant. It is stable. Low-poly heads also feed the plant shadow map, so the stain on the suit does not need the full petal mesh.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>The field stays off the body on purpose. What <em>does</em> climb him is a different system.</p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Generative Tendrils</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>I could not hand-place hundreds of vines. They had to feel grown, stay on the orange suit, and still look like the same drawing.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>I looked at <a href="https://github.com/mattatz/THREE.Tree">mattatz/THREE.Tree</a> for how a procedural plant <em>grows</em> — segment hierarchy, taper, a mesh that can reveal itself. I did not drop that generator into the scene. There is no recursive branching tree here. What I kept is a growth front along distance, packed tubes that taper, and thickness from how much load a route carries, not from generation count. The hard problem was wrapping that growth on a posed body.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>Hosts and Capsules</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Two hosts: the body and the backpack. Most of the budget goes to the body (about 90 / 10). This is a fine contact layer, not coverage — a few hundred awake tendrils, not a coat.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>Limb <strong>capsules</strong> give me regions (calf, forearm, torso, helmet) without unique code per mesh. I sample the posed surface for stations — area-weighted, not a UV grid. Helmet density is turned down. The visor should not vanish under vines.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>Rings and Feeders</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Each tendril is a partial ring around a limb, then a <strong>feeder</strong> that walks the surface from the ground (or from a trunk already on the mesh) and attaches that ring into a <strong>tree</strong>. Trees share one growth front: ground → branches → rings → hold → reverse back to the ground.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>A closest-point snap was not enough. On a calf it jumped to the other side. I start outside the limb and cast a ray inward, so the first hit is the surface on this radial side. If that fails, a local closest point is allowed only if it still faces the same way. Keeping a gap is better than a vine that tunnels through the suit.</p>
<!-- /wp:paragraph -->

<!-- wp:code -->
<pre class="wp-block-code"><code>// Start outside the calf and cast inward.
// First hit = this radial side, not the far side of the limb.
const rayOffset = Math.max(capsuleRadius * 4, 0.28);
rayOrigin.copy(center).addScaledVector(outward, rayOffset);
const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, rayOffset * 1.6);</code></pre>
<!-- /wp:code -->

<!-- wp:image -->
<figure class="wp-block-image"><!-- [IMAGE: debug — capsules + wrap paths (rings vs feeders) on the posed body] --></figure>
<!-- /wp:image -->

<!-- wp:image -->
<figure class="wp-block-image"><!-- [IMAGE: same angle, final tendril tubes] --></figure>
<!-- /wp:image -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>A Pool of Routes</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>I build more paths than I show. Only about one in three is awake. When a tree dies and comes back, it can wake on a dormant route instead of retracing the same line forever. Nearby curves share a spatial noise field, so they look like one organism, not a pile of independent splines.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":4} -->
<h4 class="wp-block-heading"><strong>One Draw, Tree Time</strong></h4>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>All tendril tubes are packed. Each segment stores a start and end distance along its tree. The same Delay / Grow / Keep / Die clock drives a growth front. A segment reveals with a smoothstep between its two distances — growth along the plant, not a VAT frame on a field instance.</p>
<!-- /wp:paragraph -->

<!-- wp:code -->
<pre class="wp-block-code"><code>function treeSegmentGrowth(growthFront, startDistance, endDistance) {
  const span = Math.max(endDistance - startDistance, 1e-6);
  const t = clamp((growthFront - startDistance) / span, 0, 1);
  return t * t * (3 - 2 * t);
}</code></pre>
<!-- /wp:code -->

<!-- wp:paragraph -->
<p>Leaves inherit that packed age. A few <strong>plumera</strong> heads — also from the Geo Nodes pack, also VAT — bind onto awake rings and rebind when a route swaps. The field stays dahlia and rose. The suit gets a different flower.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>Each tendril’s <strong>data package</strong> includes:</p>
<!-- /wp:paragraph -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li><strong>Host and role</strong>: Body or backpack; ring or feeder.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Tree id</strong>: Shared growth front for the whole vine.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Path window</strong>: Start and end distance along that tree.</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong>Wrap</strong>: Angle range, surface offset, load-based radius scale.</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:video -->
<figure class="wp-block-video"><!-- [VIDEO: tree grow from ground → rings → hold → retract] --></figure>
<!-- /wp:video -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Conclusion</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>I started as an interactive developer for physical installations. Three.js still feels like the same leap: a link, a browser, no special hardware. <em>False Earth</em> was the step into WebGPU — storage buffers, compute, an endless field.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><em>Still</em> is another step, not “more grass.” Each chapter in this series is a new expression. Here the astronaut finally stops. The picture language becomes print. A generative garden can colonize a body that is no longer trying to reach the horizon.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>He is still. The plants are not.</p>
<!-- /wp:paragraph -->

<!-- wp:image -->
<figure class="wp-block-image"><!-- [IMAGE: final wide still of the resting figure in the garden] --></figure>
<!-- /wp:image -->
