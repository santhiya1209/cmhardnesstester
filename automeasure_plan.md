# Auto-Measure — diagnosis & fix plan

**Symptom:** Auto Measure detects 3 of the 4 diamond edges correctly, but one guide line lands in the **middle** of the indent instead of on its edge (one diamond *tip* collapses toward the centroid, so its diagonal is wrong).

**TL;DR:** This is a **native (C++/OpenCV) corner-extraction weakness**, not a frontend bug and not caused by the recent refactors. The proper edge-fit corner code already exists in the native file but is **disabled**. The frontend geometry validator is also too loose to reject the bad result. Recommended path is staged: a JS-only safety net first (no rebuild), then a durable native fix (needs `electron-rebuild`).

---

## 1. What was ruled out (recent changes are NOT the cause)

- Native addon: unchanged in recent commits (last touched May).
- Comment-strip commit `b123c47`: changed **only comments** in `autoMeasureHelpers.ts` (code-only diff was empty).
- Refactor commit `e1e3889`: touched only `AutoMeasureOverlay.tsx` (keyboard inline) + hook renames — not the corner pipeline.
- Keyboard-inline / `useAutoMeasureRefs` / adjust-debounce: all on the *adjust* and *App-state* paths, not detection.

The frontend just passes `result.corners` straight through (`graphicsFromAutoMeasureResult`, `autoMeasureHelpers.ts:634`) and draws each box guide from a **single** coordinate of one tip (`left line ← corners.left.x`, `right ← corners.right.x`, `top ← corners.top.y`, `bottom ← corners.bottom.y`). So "one edge in the middle" = exactly one tip coordinate ≈ center.

---

## 2. How detection works today (live path)

File: `native/hardness-addon/src/vickers_auto_measure.cpp`

```
DecodeToGray (518)
 → Preprocess (624): robust normalize + CLAHE (auto clip) + GaussianBlur + THRESH_*_INV + morphology CLOSE/OPEN
 → SelectBestContour (1005): findContours(RETR_EXTERNAL) + area/solidity/ratio gates
        + weighted score (0.42 area + 0.20 center + 0.12 side + 0.12 diag + …)
 → ExtractAxisTipsFromContour (1554)   ← THE corners come from here
 → ValidateContourTips (1611): clamp / reject if too small/asymmetric
 → TryRefineCorners (2628): cv::cornerSubPix, ±5px, ALL-OR-NOTHING (aborts if any corner moves >5px)
 → ComputeShapeMetrics (846): d1 = dist(left,right), d2 = dist(top,bottom), ratio = max/min
```

**The proper edge-fit code is dead.** `RefineTipsForTwoLineMode` (2720–3340) and `RefineDiamondTips` (2520–2626) — which segment the contour into 4 sides, `cv::fitLine` each, and intersect adjacent sides to get sub-pixel corners — are gated off by `const bool twoLineMode = false;` (**line 3734**) and never execute. The Hough / dark-body fallbacks (`TryHoughDiamondFallback` 2373, `TryDarkBodyFallback` 2176) are also **not wired into** `MeasureVickersAuto`.

---

## 3. Root cause (confirmed at the source)

`ExtractAxisTipsFromContour` (`vickers_auto_measure.cpp:1577-1601`) selects each tip **independently** as an axis extreme with a small cross-axis "center penalty":

```cpp
const double centerPenaltyX = std::abs(p.x - center.x) * 0.10;
const double centerPenaltyY = std::abs(p.y - center.y) * 0.10;
const double topScore    = p.y + centerPenaltyX;   // top    = argmin
const double bottomScore = p.y - centerPenaltyX;   // bottom = argmax
const double leftScore   = p.x + centerPenaltyY;   // left   = argmin
const double rightScore  = p.x - centerPenaltyY;   // right  = argmax
```

Two structural weaknesses:

1. **No symmetry / radial constraint.** Nothing forces the 4 tips to be balanced about the centroid. When one edge is faint/clipped (low contrast, blur, threshold clipping), the convex hull is missing that real tip, and the extreme for that axis resolves to a hull vertex **near the centroid** → exactly one collapsed corner, the other three fine.
2. **The center penalty pulls inward.** The `0.10·offset` term (meant to prefer on-axis tips) can make a *near-center on-axis vertex beat the real off-axis tip*, actively dragging the corner toward center.

There is **no code that snaps a corner to the centroid as a default** — it is a *bad extreme*, not a centroid fallback. Consequence: a frontend guard can only **reject/flag**, never recover the true tip.

`cornerSubPix` (`TryRefineCorners`, 2628) can't help: ±5px cap, and it aborts the whole refinement if any corner moves >5px (`2644`).

`OrderDiamondCorners` (818) is also fragile: it splits 4 points into left/right vs top/bottom by X-spread; two near-coincident points (a collapse) can mis-classify a tip.

---

## 4. Ratio-based logic & heuristics — the gaps

| Gate | Native | Frontend (`validateAutoMeasureGeometry`) | Verdict |
|---|---|---|---|
| diagonal ratio | `[0.58, 1.72]` (minDiagonalRatio/maxDiagonalRatio) | `MAX_AUTO_MEASURE_DIAGONAL_RATIO = 4` → band `[0.25, 4]` (`autoMeasureHelpers.ts:286`) | **Frontend far too loose.** A half-collapse (ratio ~0.5) passes. Native 1.72 is reasonable. |
| side ratio | `maxSideLengthRatio 1.85` | — | Native check is **warning-only** (empty body at `1655`) — not enforced. |
| center distance | `maxCenterDistanceRatio` (~0.62) | `centerOk = midpointOffset <= max(12, minDiagonal*0.65)` (`autoMeasureHelpers.ts:441`) | Native version is **bypassed in 10X**; frontend `0.65` lets a 0.5 collapse pass. |
| **diagonal symmetry** | **none** | **none** | **The real gap** — nobody enforces the core Vickers invariant. |

**Why the frontend gate fails (math):** if `left` collapses to center, `d1` halves and `midD1` (mid of left↔right) shifts by ~half a diagonal → `midpointOffset ≈ 0.5·minDiagonal`, which is **under** `0.65·minDiagonal`, so `centerOk` passes. The halved ratio (~0.5) sits inside `[0.25, 4]`. `orderOk`/`distinctOk` also pass → bad geometry accepted & drawn.

The missing invariant: a real Vickers indent is (near) symmetric — the **centroid must be the midpoint of both diagonals**, and each tip should be roughly equidistant from center as its opposite.

---

## 5. OpenCV best practices for Vickers diagonals (vs current)

1. **Edge-line intersection, not axis extremes.** Fit each of the 4 indent sides as a line (`cv::fitLine`, robust DIST_HUBER) and intersect adjacent lines → sub-pixel corners. Robust to tip rounding/noise; industry-standard (Buehler/Struers). **Already implemented here, just disabled.**
2. **`approxPolyDP` → 4 hull vertices** is a much better corner *init* than per-axis extremes (the code uses it in `InitialCornerEstimate` for scoring, but not for the returned tips).
3. **`minAreaRect`** gives a robust rotated box + angle to seed side segmentation; for a clean indent its corners are already near the tips.
4. **Symmetry as a hard constraint**, not a post-hoc ratio: reject/repair when one tip's center-distance ≪ its opposite, or when diagonal midpoints diverge.
5. **`cornerSubPix` only as final polish** on already-good corners — never as the primary refinement (as it's used now).

---

## 6. Fix plan (staged)

### Step 1 — JS-only safety net (no rebuild, do first)
Goal: stop the wrong overlay being drawn/saved; fall back to rough corners or honest reject.
File: `frontend/src/features/autoMeasure/autoMeasureHelpers.ts` → `validateAutoMeasureGeometry`.

- Add a **per-tip radial-symmetry guard**: each tip must be a real distance from center, e.g. `dist(tip, center) >= 0.4 * (halfDiagonal)` for all four; OR check opposite tips are balanced (`|dist(left,c) - dist(right,c)|` and `|dist(top,c) - dist(bottom,c)|` within tolerance). A collapsed tip (dist ≈ 0) fails immediately; legitimate slightly-asymmetric diamonds pass.
- Tighten `MAX_AUTO_MEASURE_DIAGONAL_RATIO` `4 → ~1.8` (line 286).
- Tighten `centerOk` `0.65 → ~0.3` of `minDiagonal` (line 441).
- Tradeoff: more borderline detections rejected ("use manual") instead of a wrong overlay. This is a **safety net, not a cure** — it can only reject, not recover the true tip.

### Step 2 — Durable native fix (needs `npx electron-rebuild`)
File: `native/hardness-addon/src/vickers_auto_measure.cpp`.

Option A (preferred, best practice): **revive the edge-fit-and-intersect path** — set `twoLineMode = true` (line 3734) and validate/repair `RefineTipsForTwoLineMode` (2720) so corners come from `cv::fitLine` + adjacent-side intersection, with `cornerSubPix` as final polish.

Option B (lighter): **harden `ExtractAxisTipsFromContour`** (1554) — drop/replace the inward `0.10` center penalty, and after extraction reject/repair any tip whose center-distance is far below its opposite (mirror it from the opposite tip, or fall back to `approxPolyDP`/`minAreaRect` corners).

Either way: enforce the **symmetry invariant** (centroid ≈ both diagonal midpoints) inside `ValidateContourTips` (1611) so a collapsed tip is caught natively before it ever reaches the frontend.

---

## 7. Key references (file:line)

- Frontend draw from one coord per guide: `utils/manualMeasureOverlayCanvas.ts:344-370` (four-guides), `getDisplayGuidePositions:221`.
- Frontend pass-through: `features/autoMeasure/autoMeasureHelpers.ts` — `graphicsFromAutoMeasureResult:622`, `resolveAutoMeasureDetection:507`, `validateAutoMeasureGeometry:386`, constants `:285-286`.
- Native corners: `vickers_auto_measure.cpp` — `ExtractAxisTipsFromContour:1554`, `OrderDiamondCorners:818`, `ComputeShapeMetrics:846`, `ValidateContourTips:1611`, `TryRefineCorners(cornerSubPix):2628`, dead edge-fit `RefineTipsForTwoLineMode:2720` + `twoLineMode=false:3734`, params/defaults `:32-71`.
