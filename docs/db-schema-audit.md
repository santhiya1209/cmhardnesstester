# Database Schema Audit & Migration Plan

**Status:** AUDIT ONLY — no migration written, no runtime code changed, no data altered.
**Date:** 2026-06-09
**Scope:** Document the current `(id, json)` storage and propose a normalized relational target for review before any migration begins.

---

## 0. Executive summary

| Metric | Value |
| --- | --- |
| Total tables found (collections) | **21** (+ 1 internal `meta` key/value table) |
| Tables using the `(id TEXT, json TEXT)` pattern | **21 — all of them** |
| Multi-row collections | 8 |
| Singleton collections (1 row in practice) | 13 |
| New tables proposed | 2 (`images`, `test_record_measurements` junction) |
| Confirmed relationships | 2 (test_records→measurements M:N, album_items→measurements) |
| Proposed relationships (new `images` table) | 2 |
| DBML file | `docs/dbdiagram.dbml` |

**Storage today (every table):**
```
CREATE TABLE <name> (
  id   TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL
);
```
The full row object (including `id`, `createdAt`, `updatedAt`) is serialized into the `json` column. Zod (`backend/src/models/*`) is the authoritative shape; SQLite is a dumb key/blob store. Field queries are only possible via `json_extract(json, '$.field')`. See `backend/src/lib/sqlite.ts:20-42` (`COLLECTION_TO_TABLE`) and `createSchema()` at `:202-228`.

Engine: **sql.js** (WASM SQLite), whole DB held in memory and flushed to disk after each write. No native ABI concerns, but also no real relational integrity (PKs only; no FKs across the JSON blobs).

---

## 1. Discovery — files audited

| Area | Files |
| --- | --- |
| DB engine / IO | `backend/src/lib/sqlite.ts` (sql.js wrapper, schema, read/write/upsert/delete) |
| Read-modify-write layer | `backend/src/lib/db.ts` (`loadDatabase`/`saveDatabase`/`mutateDatabase`) |
| Schema aggregate | `backend/src/models/database.ts` (`DatabaseSchema`, `COLLECTION_NAMES`) |
| Models (zod) | 21 files under `backend/src/models/*` |
| Zod request schemas | 23 files under `backend/src/zod/*.schema.ts` (request validation, mirror the models) |
| Services | `backend/src/lib/services/*` (CRUD via `create-crud.service.ts`; singletons via `*-settings.service.ts`) |
| Live DB | `backend/data/hardness-tester.db` (dev) |

> Note: there is **no** `backend/src/lib/database.ts` (the task listed it). The model aggregate is `backend/src/models/database.ts`; the lib-level entry points are `db.ts` + `sqlite.ts`.

---

## 2. Table inventory (with live row counts)

Row counts read from the dev DB `backend/data/hardness-tester.db` on 2026-06-09.

| # | Table | Collection key | Kind | Rows (dev) | Purpose |
| --- | --- | --- | --- | --- | --- |
| 1 | `measurements` | measurements | multi | 0 | One indentation measurement (d1/d2/HV/depth/image). Highest-growth table. |
| 2 | `test_records` | testRecords | multi | 1 | Sample/report grouping; holds `measurementIds[]` + target HV range. |
| 3 | `album_items` | albumItems | multi | 0 | Saved gallery snapshots; optional link to a measurement. |
| 4 | `pattern_programs` | patternPrograms | multi | 0 | Saved indentation pattern programs (line/matrix/circle…). |
| 5 | `calibrations` | calibrations | multi | 2 | Pixel↔real calibration per objective/force. |
| 6 | `calibration_settings` | calibrationSettings | multi | 0 | Active pixel-to-micron per objective. |
| 7 | `toolbar_states` | toolbarStates | multi* | 2 | Last toolbar action marker (see open questions — 2 rows observed). |
| 8 | `machine_settings` | machineSettings | singleton | 1 | Force/lightness/objective/brightness map. |
| 9 | `micrometer_config` | micrometerConfig | singleton | 1 | Micrometer enable + COM port. |
| 10 | `auto_measure_settings` | autoMeasureSettings | singleton | 1 | Auto-measure thresholds/objective. |
| 11 | `line_color_settings` | lineColorSettings | singleton | 0 | Overlay line color. |
| 12 | `camera_settings` | cameraSettings | singleton | 1 | Analog gain + exposure. |
| 13 | `generic_settings` | genericSettings | singleton | 0 | Case-depth hardness + HV/HK mode. |
| 14 | `other_settings` | otherSettings | singleton | 0 | Language, accuracy, history limits. |
| 15 | `report_header_settings` | reportHeaderSettings | singleton | 1 | Report header fields. |
| 16 | `serial_port_settings` | serialPortSettings | singleton | 1 | Machine / XY / Z COM ports. |
| 17 | `depth_image_settings` | depthImageSettings | singleton | 1 | Depth image capture flags. |
| 18 | `xyz_platform_states` | xyzPlatformStates | singleton | 1 | Live XYZ position/speed/lock state. |
| 19 | `xyz_center_calibration` | xyzCenterCalibration | singleton | 1 | Taught optical center (pulses). |
| 20 | `xyz_platform_settings` | xyzPlatformSettings | singleton | 1 | XY config: reverse, pulse/mm, empty-trip, speed profiles. |
| 21 | `z_axis_settings` | zAxisSettings | singleton | 1 | Z config: reverse, pulse/mm, step, empty-trip. |

`*` `toolbar_states` is treated as a singleton-style "last action" in the model but the live DB holds 2 rows — flagged in §6.

Dependencies: all writes funnel through `db.ts` (`mutateDatabase` full read-modify-write) or the narrow `upsertRows`/`deleteRows` paths in `sqlite.ts`. The high-frequency XYZ state path uses `upsertRows` to avoid full-DB rewrites (per project memory "DB narrow persistence").

---

## 3. JSON blob inventory (current → proposed)

Below, "Current" is the JSON shape stored in the `json` column; "Proposed" is the flattened relational target. `id` is TEXT UUID PK and `created_at`/`updated_at` are ISO-8601 TEXT throughout (modeled as `datetime`). Only the non-obvious tables are expanded in full; the rest follow the same mechanical flatten and are fully specified in `docs/dbdiagram.dbml`.

### 3.1 measurements  (multi-row, hot)
**Current** `(id, json)` where json =
```
{ id, d1, d2, average, hv, depthMm, depthSource, deviceDepthMm, manualDepthMm,
  method, unit, d1Px, d2Px, d1Um, d2Um, averageUm, averageMm, micronPerPixel,
  calibrationName, objective, testForceKgf, timestamp, imageDataUrl?, xMm?, yMm?,
  qualified?, hardnessType?, convertType?, convertValue?, createdAt, updatedAt }
```
**Proposed** `measurements`:
```
id TEXT PK
d1 REAL, d2 REAL, average REAL
hv REAL NULL
depth_mm REAL NULL, depth_source TEXT NULL (device|manual)
device_depth_mm REAL NULL, manual_depth_mm REAL NULL
method TEXT (Manual|Auto|Auto (Adjusted)), unit TEXT (um|px)
d1_px REAL NULL, d2_px REAL NULL, d1_um REAL NULL, d2_um REAL NULL
average_um REAL NULL, average_mm REAL NULL, micron_per_pixel REAL NULL
calibration_name TEXT NULL, objective TEXT NULL, test_force_kgf REAL NULL
x_mm REAL NULL, y_mm REAL NULL
qualified TEXT NULL (YES|NO), hardness_type TEXT NULL
convert_type TEXT NULL, convert_value REAL NULL
image_id TEXT NULL  → images.id   (NEW; replaces inline imageDataUrl base64)
timestamp DATETIME, created_at DATETIME, updated_at DATETIME
```

### 3.2 test_records  (multi-row)
**Current** json = `{ id, sampleName, testMethod, measurementIds: string[], targetMinHv?, targetMaxHv?, createdAt, updatedAt }`
**Proposed** `test_records` (scalars only) + **NEW junction** `test_record_measurements(test_record_id, measurement_id, position)` replacing the embedded `measurementIds[]`.

### 3.3 album_items  (multi-row)
**Current** json = `{ id, title, previewLabel, hardnessImage, capturedAt, imageDataUrl?, measurementId?, createdAt, updatedAt }`
**Proposed** flatten; `measurement_id → measurements.id` (existing optional ref); `image_id → images.id` (NEW, replaces inline base64).

### 3.4 pattern_programs  (multi-row)
**Current** json = `{ id, patternName, pattern, mode, refX, refY, interval, offset, firstOffset, number, pointCount, multiset, focusAll, impressMode, checked, createdAt, updatedAt }` — all scalar, direct flatten.

### 3.5 calibrations  (multi-row)
**Current** json = `{ id, zoomTime, force, hardnessLevel, pixelLengthX, pixelLengthY, hardness, calibrationType, lengthMode?, realDistanceX?, realDistanceY?, createdAt, updatedAt }` — direct flatten.

### 3.6 calibration_settings  (multi-row)
**Current** json = `{ id, objective, normalizedObjective?, pixelToMicron, umPerPixel?, pixelPerMm?, active, calibrationDate, createdAt, updatedAt }` — direct flatten.

### 3.7 Singletons — direct flatten (all scalar)
`machine_settings`, `micrometer_config`, `auto_measure_settings`, `line_color_settings`, `camera_settings`, `generic_settings`, `other_settings`, `report_header_settings`, `serial_port_settings`, `depth_image_settings`, `xyz_platform_states`, `xyz_center_calibration`, `z_axis_settings`, `toolbar_states` — each flattens 1:1 to columns. Full column lists in `docs/dbdiagram.dbml`.

Two singletons need attention:

- **machine_settings.objectiveBrightnessMap** — `Record<string, number>` with dynamic keys (`"10X"`, `"40X"`, …). **Keep as a JSON/TEXT column** (or a small `objective_brightness(machine_settings_id, objective, value)` child table). Open-ended keys do not flatten to fixed columns.
- **xyz_platform_settings** — nested `emptyTrip{forward,backward,leftward,rightward}` + `speedProfiles{slow,mid,fast,ultra}` each with register values. Flatten to prefixed columns (`empty_trip_forward`, `slow_begin_register_value`, …). **See §6 open question — the live blob uses an older profile shape than the current model.**

---

## 4. Relationships

### 4.1 Confirmed (exist today as soft UUID references inside JSON)
No SQLite FK exists today (storage is a blob), but these references are real in code:

| From | To | Cardinality | Evidence |
| --- | --- | --- | --- |
| `test_records.measurementIds[]` | `measurements.id` | M:N | `models/test-record.ts:12` |
| `album_items.measurementId` | `measurements.id` | 0..1 | `models/album-item.ts:10` |

Proposed enforcement: M:N → `test_record_measurements` junction with real FKs; album link → nullable FK `album_items.measurement_id`.

### 4.2 Proposed (depend on the NEW `images` table)
| From | To | Cardinality | Rationale |
| --- | --- | --- | --- |
| `measurements.image_id` | `images.id` | 0..1 | Move inline base64 `imageDataUrl` out of the hot table. |
| `album_items.image_id` | `images.id` | 0..1 | Same — base64 snapshots bloat the row. |

### 4.3 Uncertain relationships (NOT drawn — need product decision)
- `measurements.calibrationName` (TEXT) loosely corresponds to a `calibration_settings`/`calibrations` entry, but it is stored as a free label, not an id. Do **not** FK without a deliberate id migration.
- `measurements.objective` ↔ `calibration_settings.objective` / `calibrations.zoomTime` — string-matched, not id-linked.
- No `reports` table exists. Reports are generated at runtime from `test_records` + their measurements. The task's example `reports.measurement_id > measurements.id` has **no current counterpart**; `test_records` is the closest existing entity.
- No `images` table exists today — it is a proposal, not a discovered relationship.

---

## 5. Migration plan (per JSON table)

General sequenced strategy (same 6 steps the task specifies), applied additively so JSON stays the rollback source until a later release:

1. **Add columns** — `ALTER TABLE … ADD COLUMN` for each normalized field (nullable first). Keep the `json` column in place.
2. **Backfill** — read each row's `json`, `json_extract` each field, write the new columns. For arrays/maps, populate junction/child tables.
3. **Validate** — assert `COUNT(*)` unchanged per table; spot-check `json_extract(json,'$.x') == new_column` for a sample; assert junction counts equal `sum(len(measurementIds))`.
4. **Switch read path** — point services/models at columns instead of `JSON.parse(json)`. (Separate task; touches `sqlite.ts` read helpers + `db.ts`.)
5. **Keep JSON for rollback** — leave `json` populated and dual-written for one release.
6. **Remove JSON** — drop the `json` column in a later release once columns are proven.

### 5.1 Recommended migration ORDER
Order by dependency and risk (independent → referenced → referencing → junction):

1. **Singletons first** (lowest risk, 1 row each, no refs): `line_color_settings`, `camera_settings`, `micrometer_config`, `generic_settings`, `other_settings`, `report_header_settings`, `serial_port_settings`, `depth_image_settings`, `auto_measure_settings`, `z_axis_settings`, `xyz_center_calibration`, `xyz_platform_states`, `machine_settings` (handle brightness map), `xyz_platform_settings` (handle profile drift — do this one carefully).
2. **`images`** (NEW table) — create before the tables that reference it.
3. **`measurements`** — the referenced hot table; extract images here.
4. **`album_items`** — references measurements + images.
5. **`calibrations`, `calibration_settings`, `pattern_programs`, `toolbar_states`** — independent multi-row, any order.
6. **`test_records`** then **`test_record_measurements`** junction — last, because it references measurements.

### 5.2 Risk per table

| Risk | Tables | Why |
| --- | --- | --- |
| **Low** | all 13 singletons except machine_settings & xyz_platform_settings; `line_color_settings`, `toolbar_states`, `calibrations`, `calibration_settings`, `pattern_programs` | One row or few rows, all-scalar, no inbound refs. |
| **Medium** | `machine_settings` (dynamic brightness map), `measurements` (volume + image extraction), `album_items` (two refs), `images` (new, base64 volume) | Sub-objects / size / new relationships. |
| **High** | `xyz_platform_settings`, `test_records` + junction | Live blob shape ≠ model (profile drift); array→junction normalization that other reads depend on. |

---

## 6. Open questions (resolve before migration)

1. **xyz_platform_settings live drift.** The live DB blob stores `speedProfiles.<tier> = { stepDistanceMm, beginSpeedMmS, accelerationMmS2, finalSpeedMmS, registerValue }`, but the current (uncommitted) model expects `{ beginRegisterValue, accelerationRegisterValue, finalRegisterValue, approxMmS }`. The proposed columns follow the **model**. Backfill must decide: re-seed from `DEFAULT_XYZ_PLATFORM_SETTINGS`, or map old→new fields? (There is no clean mapping — old has no `*RegisterValue` triplet.) **Needs product decision.**
2. **toolbar_states cardinality.** Model looks singleton-ish but the live DB has 2 rows. Is this an append log (keep multi-row) or should it be a true singleton (dedupe on migrate)?
3. **images table — adopt or not?** Extracting base64 into `images` is a real normalization win (keeps `measurements`/`album_items` small) but is NEW. Confirm before modeling FKs around it. If rejected, keep `image_data_url TEXT` inline on both tables.
4. **objectiveBrightnessMap storage.** Keep as JSON column, or normalize to `objective_brightness(setting_id, objective, value)` child table? Dynamic keys argue for one of these two — not fixed columns.
5. **Free-text vs id references.** `measurements.calibrationName` / `objective` are labels, not ids. Convert to real FKs during migration, or leave as denormalized labels (they snapshot the value at save time on purpose)?
6. **`line_color_settings` has no `created_at`** in its model (only `updated_at`). Add `created_at` for consistency, or preserve the asymmetry?
7. **Enum enforcement.** SQLite has no native enum. Enforce via `CHECK` constraints, or keep enforcement in zod only (as today)?

---

## 7. Deliverables checklist

- [x] `docs/db-schema-audit.md` (this file)
- [x] `docs/dbdiagram.dbml` (import-ready)
- [ ] `docs/db-schema.png` — diagram image export. **Manual step required** — see §8. Could not be auto-generated (dbdiagram.io is an external web app; no headless browser/screenshot tooling is used in this project by policy).

---

## 8. How to generate the DBDiagram.io image (manual, ~30 s)

1. Open <https://dbdiagram.io> → **Create new diagram** (or use the menu **Import**).
2. Open `docs/dbdiagram.dbml`, copy the entire contents, paste into the left editor pane.
3. The diagram renders on the right. Verify: 21 existing tables + `images` + `test_record_measurements` appear, and 4 relationship lines are drawn (test_record_measurements→test_records, test_record_measurements→measurements, album_items→measurements, measurements→images, album_items→images).
4. **Export:** top toolbar **Export → Export to PNG** (or PDF). Save the PNG as `docs/db-schema.png`.
5. Commit the PNG alongside these files.

If the `.dbml` fails to parse on import, it will point to a line — send it over and I'll fix the syntax.
