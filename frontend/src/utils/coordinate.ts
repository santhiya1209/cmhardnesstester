/**
 * Coordinate display normalization for the Multipoint feature. Pixel→mm
 * conversion and float subtraction leave sub-micron residues (e.g. a centre
 * click reading `-0.00007`), and JS can produce negative zero. Both should read
 * as a clean `0` everywhere a coordinate is shown or stored as an origin.
 */

// 0.5 µm. Below the XY stage's own resolution (1/1600 mm ≈ 0.625 µm per pulse),
// so snapping anything smaller to zero never hides a move the hardware could
// actually make, and never merges two genuinely distinct indentation points.
export const ZERO_TOLERANCE_MM = 5e-4;

/**
 * Snap a coordinate that is within {@link ZERO_TOLERANCE_MM} of zero to exactly
 * `0` (also collapsing `-0`), and leave every real value untouched. Apply BEFORE
 * `toFixed` at display sites, and to the captured click offset so the stored
 * reference — and every point generated from it — is clean at the source.
 */
export function normalizeCoordinate(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.abs(value) < ZERO_TOLERANCE_MM ? 0 : value;
}

/**
 * Origin a READ-ONLY coordinate readout is shown relative to. Prefer the taught
 * working centre (relocation origin); when it has not been set, fall back to the
 * live stage position (the optical crosshair) so a freshly picked reference reads
 * as the pure offset from the crosshair — right = +X, up = −Y — matching the
 * on-camera marker, instead of degenerating to the absolute stage frame.
 *
 * Only for display: the stored absolute coordinates that generation and stage
 * motion consume are never derived from this. Do NOT use it as the origin for an
 * EDITABLE field — its inverse (typed → absolute) needs a stable origin, and the
 * live position drifts as the stage moves.
 */
export function resolveDisplayOrigin(
  relocationOriginMm: { x: number; y: number } | null,
  positionMm: { x: number; y: number },
  positionKnown: boolean
): { x: number; y: number } {
  if (relocationOriginMm) return relocationOriginMm;
  if (positionKnown) return positionMm;
  return { x: 0, y: 0 };
}
