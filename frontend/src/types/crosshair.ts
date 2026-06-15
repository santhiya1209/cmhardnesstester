/**
 * Style for the fixed center-cross reticle drawn on the optical axis (the
 * "Center Cross Line" tool). The reticle is a microscope sighting aid, not a
 * measurement shape — it always sits at the image center regardless of mode.
 */
export type CrosshairConfig = {
  /** Colour of the full-image vertical + horizontal crosshair lines. */
  color: string;
  /** Crosshair line thickness in CSS pixels. */
  thickness: number;
  /** Half-length of the white centre pointer marker in CSS pixels. */
  markerSize: number;
};

export const DEFAULT_CROSSHAIR_CONFIG: CrosshairConfig = {
  color: '#FFEB3B',
  thickness: 1,
  markerSize: 10,
};
