/**
 * Ground shadow: an ink wash plus a drawn contour.
 *
 * Both are readings of the SAME 0..1 shadow field at different levels — `washAt`
 * floods everything deeper than itself, `contourAt` traces one level line. They
 * are independent, so the contour can sit inside, on, or outside the wash edge.
 * At these defaults `contourAt` (0.35) is below `washAt` (0.47), which puts the
 * line just outside the blob rather than on its border.
 */
export const SHADOW_DEFAULTS = {
  // --- Wash: the filled blob -------------------------------------------------
  washColor: '#4e5769',
  washStr: 0.29,
  /** Level the boundary sits at. Lower = bigger blob. */
  washAt: 0.47,
  washSoft: 0.45,
  /** Scale of the one noise field that drives both bleed and mottle. */
  washScale: 3.1,
  /**
   * Added to the shadow VALUE before the threshold. Not a domain warp — the
   * threshold is what turns a value offset into a positional one, so the boundary
   * creeps in and out like ink bleeding past where it was laid. Controls SHAPE.
   */
  washBleed: 0.36,
  /** Multiplied in after, so it cannot move the boundary — controls DENSITY. */
  washMottle: 0.91,

  // --- Contour: the drawn line -----------------------------------------------
  contourColor: '#232a42',
  contourStr: 0.45,
  /** Which level of the field to trace. Independent of `washAt`. */
  contourAt: 0.35,
  contourWidth: 1.5,
  /** Separate, much finer noise than the wash: jitters the level per pixel. */
  contourWobble: 1.25,
  contourScale: 21,
};
