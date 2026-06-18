// Image-sharpness (focus) score — variance of the Laplacian, a standard passive
// autofocus metric. Higher = sharper (more high-frequency edge content). Computed
// on a CENTRED crop of the frame (where the indent sits), in grayscale, subsampled
// for speed on large camera frames. Pure JS — no native addon, no rebuild.
//
// It is a RELATIVE score only: compare values for the SAME point/scene to judge
// which frame is sharper. It is NOT a calibrated absolute number, so never gate on
// a fixed threshold across different samples/objectives.

/**
 * Variance of the 4-neighbour Laplacian over a centred, subsampled region of an
 * 8-bit interleaved frame (e.g. bgr24). Returns 0 for an empty/degenerate frame.
 *
 * `roiFraction` is the fraction of width/height the centred scoring window spans
 * (legacy autofocus evaluates the centre 40% of the image, hence the 0.4 default).
 */
export function varianceOfLaplacian(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  channels = 3,
  roiFraction = 0.4
): number {
  if (width <= 0 || height <= 0 || channels <= 0) return 0;
  const bytes = new Uint8Array(buffer);
  if (bytes.length < width * height * channels) return 0;

  // Centred crop (centre roiFraction of the frame, 40% by default) keeps the
  // score on the indentation region and bounds cost; subsample by `step` so a
  // 2592-wide frame stays cheap.
  const frac = roiFraction > 0 && roiFraction <= 1 ? roiFraction : 0.4;
  const cropW = Math.max(8, Math.floor(width * frac));
  const cropH = Math.max(8, Math.floor(height * frac));
  const x0 = Math.floor((width - cropW) / 2);
  const y0 = Math.floor((height - cropH) / 2);
  const step = 2;

  const gray = (x: number, y: number): number => {
    const i = (y * width + x) * channels;
    // Simple channel average — adequate as a relative sharpness proxy and order-
    // independent for bgr vs rgb.
    return (bytes[i] + bytes[i + 1] + bytes[i + 2]) / 3;
  };

  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = y0 + step; y < y0 + cropH - step; y += step) {
    for (let x = x0 + step; x < x0 + cropW - step; x += step) {
      const lap =
        gray(x - step, y) + gray(x + step, y) + gray(x, y - step) + gray(x, y + step) - 4 * gray(x, y);
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return variance > 0 ? variance : 0;
}
