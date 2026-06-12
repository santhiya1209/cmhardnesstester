import { useCallback, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  clearPoints,
  deletePoint,
  deletePoints,
  deselectPoint,
  markPointCompleted,
  resetExecutionProgress,
  resetMultipoint,
  selectPoint,
  setActivePoint,
  setGenerating,
  setGeneratedPoints,
  setMode,
  setSelectedPointIds,
  updateConfig,
  updateProgramMeta,
} from '@/store/slices/multipoint.slice';
import {
  selectGeneratedPoints,
  selectIsGenerating,
  selectPatternConfig,
  selectPatternMode,
  selectProgramMeta,
  selectSelectedPointIds,
} from '@/store/slices/multipoint.selectors';
import { usePatternPrograms } from '@/hooks/queries/usePatternPrograms';
import { useSavePatternProgram } from '@/hooks/mutations/useSavePatternProgram';
import { useXyzStageState } from '@/hooks/queries/useXyzStageState';
import { useXyzPlatformHardware } from '@/features/xyzPlatform/useXyzPlatformHardware';
import { arePointsVerticallyAligned, generatePattern } from '@/utils/patternGeneration';
import { buildMultipointExecutionRequest } from '@/utils/multipointExecution';
import { configFromProgram, metaFromProgram, toPayload } from '@/utils/patternProgramMapping';
import type { ProgramMeta } from '@/types/multipoint';
import type {
  CompositeLine,
  FreePoint,
  PatternGenerationRequest,
  PatternMode,
  TriangleDefinition,
} from '@/types/patternProgram';

// Stable per-row id for captured/entered points (selection + React keys). Local
// counter avoids any Web-Crypto lib assumptions; uniqueness within a session is
// all the editor needs.
let pointIdCounter = 0;
function createPointId(): string {
  pointIdCounter += 1;
  return `fp-${Date.now().toString(36)}-${pointIdCounter}`;
}

// Case Depth uses exactly two reference points: slot 0 = origin, slot 1 =
// direction. The fixed-slot model keeps the array dense ([], [o], [o, d]) —
// never sparse — so it always persists cleanly.
const CASE_DEPTH_ORIGIN = 0;
const CASE_DEPTH_DIRECTION = 1;

// A fresh MultiLine Composite line: a usable 10mm horizontal starter the
// operator then edits. Stable id (same scheme as free/reference rows) so the
// table row tracks selection and reorders without remounting on edit.
function createCompositeLine(): CompositeLine {
  return {
    id: createPointId(),
    move: 'Horizontal',
    startX: 0,
    startY: 0,
    endX: 10,
    endY: 0,
    interval: 1,
    offset: 0,
    firstOffset: 0,
  };
}

// A fresh Equidistant Triangle row: blank vertices (NaN) the operator fills in.
// Stable id (same scheme as the other row editors) so the table row tracks
// selection and merges edits in place without remounting on each keystroke.
function createTriangle(): TriangleDefinition {
  return { id: createPointId(), x1: NaN, y1: NaN, x2: NaN, y2: NaN, x3: NaN, y3: NaN };
}

/**
 * Single state surface for the Multipoint feature. Reads the Redux slice via
 * memoization-free field selectors, exposes typed action dispatchers, runs
 * pattern generation through `utils/patternGeneration.ts`, and captures real
 * stage coordinates from the same `useXyzStageState` flow the machine-control
 * tabs use. Save/Load go through the existing RTK Query pattern-program hooks.
 */
export function useMultipoint() {
  const dispatch = useAppDispatch();
  const mode = useAppSelector(selectPatternMode);
  const config = useAppSelector(selectPatternConfig);
  const generatedPoints = useAppSelector(selectGeneratedPoints);
  const selectedPointIds = useAppSelector(selectSelectedPointIds);
  const isGenerating = useAppSelector(selectIsGenerating);
  const programMeta = useAppSelector(selectProgramMeta);

  const {
    data: patternPrograms,
    error: patternProgramsError,
    loading: patternProgramsLoading,
    refetch: refetchPatternPrograms,
  } = usePatternPrograms();
  const { error: saveError, savePatternProgram, saving } = useSavePatternProgram();
  const stage = useXyzStageState();
  const hardware = useXyzPlatformHardware();

  const [loadedProgramId, setLoadedProgramId] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  // Vertical Line Free Points: when the entered X values are not aligned the
  // operator must explicitly opt in before Generate proceeds (see `generate`).
  const [alignmentOverride, setAlignmentOverride] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('No saved pattern program yet.');
  // Bumped on Load/Reset to remount the (uncontrolled) numeric inputs so they
  // re-read the replaced config — without storing per-keystroke string buffers.
  const [formRevision, setFormRevision] = useState(0);

  const loadedProgram = patternPrograms.find((program) => program.id === loadedProgramId) ?? null;
  const errorMessage = patternProgramsError ?? saveError ?? generationError;
  const isBusy = patternProgramsLoading || saving || executing;

  const changeMode = useCallback(
    (value: PatternMode) => {
      dispatch(setMode(value));
      setAlignmentOverride(false);
      // Equidistant Multipoint always shows at least two reference rows. Seed
      // empty slots (NaN = "not entered yet", filtered out by generation and on
      // Save) with stable ids so typing into Ref 1 / Ref 2 merges in place
      // without the row remounting on the first keystroke.
      if (value === 'Equidistant Multipoint Mode') {
        const refs = config.referencePoints ?? [];
        if (refs.length < 2) {
          const seeded = refs.slice();
          while (seeded.length < 2) seeded.push({ id: createPointId(), x: NaN, y: NaN });
          dispatch(updateConfig({ referencePoints: seeded }));
        }
      }
      // Equidistant Three Point shows a table of 3-point rows (referencePoints in
      // groups of 3). Seed one empty row so the operator can type without first
      // clicking Add.
      if (value === 'Equidistant Three Point Mode') {
        const refs = config.referencePoints ?? [];
        if (refs.length < 3) {
          const seeded = refs.slice();
          while (seeded.length < 3) seeded.push({ id: createPointId(), x: NaN, y: NaN });
          dispatch(updateConfig({ referencePoints: seeded }));
        }
      }
      // Equidistant Triangle shows a table of triangle rows. Seed one empty row
      // (blank vertices, dropped by generation/Save) so the operator can type
      // without first clicking Add Triangle.
      if (value === 'Equidistant Triangle Mode') {
        if ((config.triangles ?? []).length === 0) {
          dispatch(updateConfig({ triangles: [createTriangle()] }));
        }
      }
    },
    [dispatch, config.referencePoints, config.triangles]
  );
  const changeConfig = useCallback(
    (patch: Partial<PatternGenerationRequest>) => dispatch(updateConfig(patch)),
    [dispatch]
  );
  const changeProgramMeta = useCallback(
    (patch: Partial<ProgramMeta>) => dispatch(updateProgramMeta(patch)),
    [dispatch]
  );

  const toggleSelect = useCallback(
    (id: string, selected: boolean) => dispatch(selected ? selectPoint(id) : deselectPoint(id)),
    [dispatch]
  );
  const removePoint = useCallback((id: string) => dispatch(deletePoint(id)), [dispatch]);
  const removeSelected = useCallback(
    () => dispatch(deletePoints(selectedPointIds)),
    [dispatch, selectedPointIds]
  );
  const clearGenerated = useCallback(() => dispatch(clearPoints()), [dispatch]);

  const generate = useCallback(() => {
    // Vertical-line guard: refuse to generate a "vertical" line whose X values
    // wander, unless the operator has explicitly overridden the alignment check.
    if (
      config.mode === 'Vertical Line Free Points Mode' &&
      !alignmentOverride &&
      !arePointsVerticallyAligned(config.freePoints ?? [])
    ) {
      setGenerationError(
        'Points are not aligned vertically. Enable "Override alignment" to generate anyway.'
      );
      setStatusMessage('Generation blocked: points are not aligned vertically.');
      return;
    }
    dispatch(setGenerating(true));
    const result = generatePattern(config, { multiset: programMeta.multiset });
    if (!result.success) {
      setGenerationError(result.error ?? 'Pattern generation failed.');
      setStatusMessage('Generation failed.');
      dispatch(setGenerating(false));
      return;
    }
    setGenerationError(null);
    dispatch(setGeneratedPoints(result.points));
    setStatusMessage(`Generated ${result.points.length} point(s) using ${mode}.`);
  }, [config, mode, programMeta.multiset, alignmentOverride, dispatch]);

  // Select / clear every generated point at once (preview-table "Select All").
  const toggleSelectAll = useCallback(
    (selected: boolean) =>
      dispatch(setSelectedPointIds(selected ? generatedPoints.map((point) => point.id) : [])),
    [dispatch, generatedPoints]
  );

  // Manual blank row — the operator edits its coordinates in the table.
  const addFreePoint = useCallback(() => {
    const next = [...(config.freePoints ?? []), { id: createPointId(), x: 0, y: 0 }];
    dispatch(updateConfig({ freePoints: next }));
  }, [config.freePoints, dispatch]);

  // Append the live stage position (same XYZ flow as the machine-control tabs).
  const captureFreePoint = useCallback(() => {
    if (!stage.positionKnown) {
      setStatusMessage('Stage position unknown — connect and home the platform first.');
      return;
    }
    const next = [
      ...(config.freePoints ?? []),
      { id: createPointId(), x: stage.positionMm.x, y: stage.positionMm.y },
    ];
    dispatch(updateConfig({ freePoints: next }));
    setStatusMessage(`Captured point ${next.length} at stage position.`);
  }, [config.freePoints, stage.positionKnown, stage.positionMm.x, stage.positionMm.y, dispatch]);

  const updateFreePoint = useCallback(
    (id: string, patch: Partial<FreePoint>) => {
      const next = (config.freePoints ?? []).map((point) => (point.id === id ? { ...point, ...patch } : point));
      dispatch(updateConfig({ freePoints: next }));
    },
    [config.freePoints, dispatch]
  );

  const deleteFreePoint = useCallback(
    (id: string) => {
      const next = (config.freePoints ?? []).filter((point) => point.id !== id);
      dispatch(updateConfig({ freePoints: next }));
    },
    [config.freePoints, dispatch]
  );

  const clearFreePoints = useCallback(() => dispatch(updateConfig({ freePoints: [] })), [dispatch]);

  // Case Depth captures real coordinates from the same XYZ stage flow as the
  // machine-control tabs — never mocked. Origin (slot 0) must exist before the
  // Direction (slot 1) can be captured, which keeps the array dense.
  const captureReferencePoint = useCallback(
    (slot: number) => {
      if (!stage.positionKnown) {
        setStatusMessage('Stage position unknown — connect and home the platform first.');
        return;
      }
      const current = config.referencePoints ?? [];
      if (slot === CASE_DEPTH_DIRECTION && current.length < 1) {
        setStatusMessage('Capture the Origin point before the Direction point.');
        return;
      }
      const next = current.slice();
      next[slot] = { id: createPointId(), x: stage.positionMm.x, y: stage.positionMm.y };
      dispatch(updateConfig({ referencePoints: next }));
      setStatusMessage(`Captured ${slot === CASE_DEPTH_ORIGIN ? 'Origin' : 'Direction'} point at stage position.`);
    },
    [config.referencePoints, stage.positionKnown, stage.positionMm.x, stage.positionMm.y, dispatch]
  );

  // Circle Mode shares the referencePoints slots: [0] = Circle Center, [1] = a
  // point on the circumference (radius = distance between them). Center must be
  // captured before the edge so the array stays dense.
  const captureCirclePoint = useCallback(
    (slot: number) => {
      if (!stage.positionKnown) {
        setStatusMessage('Stage position unknown — connect and home the platform first.');
        return;
      }
      const current = config.referencePoints ?? [];
      if (slot === CASE_DEPTH_DIRECTION && current.length < 1) {
        setStatusMessage('Capture the Circle Center before the Reference point.');
        return;
      }
      const next = current.slice();
      next[slot] = { id: createPointId(), x: stage.positionMm.x, y: stage.positionMm.y };
      dispatch(updateConfig({ referencePoints: next }));
      setStatusMessage(`Captured ${slot === CASE_DEPTH_ORIGIN ? 'Circle Center' : 'Reference'} point at stage position.`);
    },
    [config.referencePoints, stage.positionKnown, stage.positionMm.x, stage.positionMm.y, dispatch]
  );

  // Fine-tune an already-captured reference point in place; the slot must exist
  // (the UI only enables a slot's inputs once it has been captured).
  const updateReferencePoint = useCallback(
    (slot: number, patch: Partial<FreePoint>) => {
      const next = (config.referencePoints ?? []).map((point, i) => (i === slot ? { ...point, ...patch } : point));
      dispatch(updateConfig({ referencePoints: next }));
    },
    [config.referencePoints, dispatch]
  );

  // Equidistant Multipoint uses an arbitrary-length reference list (Ref 1, Ref 2,
  // Ref 3 … via "Add Point"). These three handlers are index-based and create the
  // slot if it does not exist yet, so typing, capturing, and adding all work on a
  // sparse-free dense array regardless of how many references the operator defines.
  const setReferenceSlot = useCallback(
    (slot: number, patch: Partial<FreePoint>) => {
      const current = config.referencePoints ?? [];
      const next = current.slice();
      while (next.length <= slot) next.push({ id: createPointId(), x: NaN, y: NaN });
      next[slot] = { ...next[slot], ...patch };
      dispatch(updateConfig({ referencePoints: next }));
    },
    [config.referencePoints, dispatch]
  );

  const captureReferenceSlot = useCallback(
    (slot: number) => {
      if (!stage.positionKnown) {
        setStatusMessage('Stage position unknown — connect and home the platform first.');
        return;
      }
      const current = config.referencePoints ?? [];
      const next = current.slice();
      while (next.length <= slot) next.push({ id: createPointId(), x: NaN, y: NaN });
      // Fresh id on capture so the reference row remounts and re-seeds its input
      // buffers to the captured coordinates (same pattern as Case Depth / Circle).
      next[slot] = { id: createPointId(), x: stage.positionMm.x, y: stage.positionMm.y };
      dispatch(updateConfig({ referencePoints: next }));
      setStatusMessage(`Captured reference point ${slot + 1} at stage position.`);
    },
    [config.referencePoints, stage.positionKnown, stage.positionMm.x, stage.positionMm.y, dispatch]
  );

  const addReferenceSlot = useCallback(() => {
    const current = config.referencePoints ?? [];
    dispatch(updateConfig({ referencePoints: [...current, { id: createPointId(), x: NaN, y: NaN }] }));
  }, [config.referencePoints, dispatch]);

  // Equidistant Three Point stores its row table in referencePoints, 3 slots per
  // row (row r → indices 3r, 3r+1, 3r+2 = P1, P2, P3). These handlers keep that
  // grouping intact: Add appends a full empty row, Delete removes a whole row,
  // and cell edits target one point within a row, creating slots as needed so an
  // edit never lands in a sparse array.
  const addThreePointRow = useCallback(() => {
    const current = config.referencePoints ?? [];
    dispatch(
      updateConfig({
        referencePoints: [
          ...current,
          { id: createPointId(), x: NaN, y: NaN },
          { id: createPointId(), x: NaN, y: NaN },
          { id: createPointId(), x: NaN, y: NaN },
        ],
      })
    );
  }, [config.referencePoints, dispatch]);

  const updateThreePointCell = useCallback(
    (row: number, pointInRow: number, patch: Partial<FreePoint>) => {
      const index = row * 3 + pointInRow;
      const current = config.referencePoints ?? [];
      const next = current.slice();
      while (next.length <= index) next.push({ id: createPointId(), x: NaN, y: NaN });
      next[index] = { ...next[index], ...patch };
      dispatch(updateConfig({ referencePoints: next }));
    },
    [config.referencePoints, dispatch]
  );

  const deleteThreePointRow = useCallback(
    (row: number) => {
      const current = config.referencePoints ?? [];
      const next = current.slice();
      next.splice(row * 3, 3);
      dispatch(updateConfig({ referencePoints: next }));
    },
    [config.referencePoints, dispatch]
  );

  const clearThreePointRows = useCallback(
    () => dispatch(updateConfig({ referencePoints: [] })),
    [dispatch]
  );

  // MultiLine Composite line list — each line is an independent Start→End/Move/
  // Interval definition. CRUD + reorder all go through updateConfig so the lines
  // persist with the program and Save/Load round-trips the whole layout.
  const addCompositeLine = useCallback(() => {
    dispatch(updateConfig({ lines: [...(config.lines ?? []), createCompositeLine()] }));
  }, [config.lines, dispatch]);

  const updateCompositeLine = useCallback(
    (id: string, patch: Partial<CompositeLine>) => {
      const next = (config.lines ?? []).map((line) => (line.id === id ? { ...line, ...patch } : line));
      dispatch(updateConfig({ lines: next }));
    },
    [config.lines, dispatch]
  );

  const deleteCompositeLine = useCallback(
    (id: string) => {
      dispatch(updateConfig({ lines: (config.lines ?? []).filter((line) => line.id !== id) }));
    },
    [config.lines, dispatch]
  );

  const moveCompositeLine = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const lines = (config.lines ?? []).slice();
      const index = lines.findIndex((line) => line.id === id);
      if (index < 0) return;
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= lines.length) return;
      [lines[index], lines[target]] = [lines[target], lines[index]];
      dispatch(updateConfig({ lines }));
    },
    [config.lines, dispatch]
  );

  // Equidistant Triangle table — each row is one triangle (three vertices). CRUD
  // goes through updateConfig so the triangles persist with the program; the
  // shared `interval` field sets the edge spacing.
  const addTriangle = useCallback(() => {
    dispatch(updateConfig({ triangles: [...(config.triangles ?? []), createTriangle()] }));
  }, [config.triangles, dispatch]);

  const updateTriangle = useCallback(
    (id: string, patch: Partial<TriangleDefinition>) => {
      const next = (config.triangles ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t));
      dispatch(updateConfig({ triangles: next }));
    },
    [config.triangles, dispatch]
  );

  const deleteTriangles = useCallback(
    (ids: string[]) => {
      const remove = new Set(ids);
      dispatch(updateConfig({ triangles: (config.triangles ?? []).filter((t) => !remove.has(t.id)) }));
    },
    [config.triangles, dispatch]
  );

  const clearTriangles = useCallback(() => {
    dispatch(updateConfig({ triangles: [] }));
  }, [dispatch]);

  const save = useCallback(async () => {
    const payload = toPayload(config, mode, programMeta, loadedProgram?.checked ?? true);
    const saved = await savePatternProgram({ id: loadedProgram?.id, values: payload });
    setLoadedProgramId(saved.id);
    setStatusMessage(`Saved ${saved.patternName}.`);
    await refetchPatternPrograms();
  }, [config, mode, programMeta, loadedProgram?.checked, loadedProgram?.id, refetchPatternPrograms, savePatternProgram]);

  const load = useCallback(() => {
    const program = patternPrograms[0] ?? null;
    if (!program) {
      setStatusMessage('No saved pattern program to load.');
      return;
    }
    dispatch(setMode(program.mode));
    dispatch(updateConfig(configFromProgram(program)));
    dispatch(updateProgramMeta(metaFromProgram(program)));
    setLoadedProgramId(program.id);
    setGenerationError(null);
    setFormRevision((revision) => revision + 1);
    setStatusMessage(`Loaded ${program.patternName}.`);
  }, [patternPrograms, dispatch]);

  const reset = useCallback(() => {
    dispatch(resetMultipoint());
    setLoadedProgramId(null);
    setGenerationError(null);
    setAlignmentOverride(false);
    setFormRevision((revision) => revision + 1);
    setStatusMessage('Reset to default multipoint values.');
  }, [dispatch]);

  // Execute the generated pattern: drive the stage to each point in order via the
  // existing RX-gated hardware path (hardware.moveToPoint → IPC → backend
  // relocation engine). Each move is AWAITED, so the next point starts only after
  // the controller confirms the landing position (no optimistic completion). Points
  // are mm offsets from the taught optical center — the backend owns the conversion
  // and the truth. Gates read the backend snapshot (no frontend state copies).
  const start = useCallback(async () => {
    if (generatedPoints.length === 0) {
      setStatusMessage('Generate a pattern before Start.');
      return;
    }
    if (!stage.connected) {
      setStatusMessage('Connect the XYZ stage before Start.');
      return;
    }
    if (!stage.xyLocked) {
      setStatusMessage('Lock the X/Y stage before Start.');
      return;
    }
    if (stage.centerX === null || stage.centerY === null) {
      setStatusMessage('Set the optical center (Set Center) before Start — points are relative to it.');
      return;
    }

    const request = buildMultipointExecutionRequest(generatedPoints, programMeta);
    // eslint-disable-next-line no-console
    console.log(
      `[multipoint-start] points=${request.points.length} mode=${mode} impressMode=${request.impressMode} multiset=${request.multiset} focusAll=${request.focusAll} connected=${stage.connected} xyLocked=${stage.xyLocked} centerX=${stage.centerX} centerY=${stage.centerY}`
    );

    setExecuting(true);
    setGenerationError(null);
    // Clear any previous run's completed/active markers so the overlay starts
    // all-pending (white) for this run.
    dispatch(resetExecutionProgress());
    try {
      for (let i = 0; i < request.points.length; i += 1) {
        const point = request.points[i];
        // Mark the live target so the camera pattern overlay highlights it (red).
        dispatch(setActivePoint(point.id));
        // eslint-disable-next-line no-console
        console.log(`[multipoint-point] index=${i + 1}/${request.points.length} no=${point.no} targetX=${point.x} targetY=${point.y}`);
        setStatusMessage(`Moving to point ${point.no} of ${request.points.length}…`);
        // eslint-disable-next-line no-console
        console.log(`[multipoint-move-request] index=${i + 1} no=${point.no} targetX=${point.x} targetY=${point.y}`);
        const result = await hardware.moveToPoint(point.x, point.y);
        // eslint-disable-next-line no-console
        console.log(`[multipoint-move-dispatched] index=${i + 1} no=${point.no} ok=${result.ok}`);
        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.error(
            `[multipoint-error] index=${i + 1} no=${point.no} error=${JSON.stringify(result.error)} message=${JSON.stringify(result.message ?? null)}`
          );
          setStatusMessage(`Stopped at point ${point.no}: ${result.message ?? result.error}`);
          return;
        }
        // eslint-disable-next-line no-console
        console.log(
          `[multipoint-position-reached] index=${i + 1} no=${point.no} x=${result.position?.x ?? 'unknown'} y=${result.position?.y ?? 'unknown'} source=hardware-rx`
        );
        // Point reached → mark it completed so the overlay turns it green.
        dispatch(markPointCompleted(point.id));
      }
      // eslint-disable-next-line no-console
      console.log(`[multipoint-finished] points=${request.points.length}`);
      setStatusMessage(`Executed ${request.points.length} point(s).`);
    } finally {
      setExecuting(false);
      dispatch(setActivePoint(null));
    }
  }, [generatedPoints, programMeta, mode, hardware, stage.connected, stage.xyLocked, stage.centerX, stage.centerY, dispatch]);

  return {
    // state
    mode,
    config,
    generatedPoints,
    selectedPointIds,
    isGenerating,
    programMeta,
    loadedProgram,
    stageReady: stage.positionKnown,
    formRevision,
    statusMessage,
    errorMessage,
    isBusy,
    alignmentOverride,
    // typed actions
    setMode: changeMode,
    updateConfig: changeConfig,
    updateProgramMeta: changeProgramMeta,
    generatePattern: generate,
    addFreePoint,
    captureFreePoint,
    updateFreePoint,
    deleteFreePoint,
    clearFreePoints,
    captureReferencePoint,
    captureCirclePoint,
    updateReferencePoint,
    setReferenceSlot,
    captureReferenceSlot,
    addReferenceSlot,
    addThreePointRow,
    updateThreePointCell,
    deleteThreePointRow,
    clearThreePointRows,
    addCompositeLine,
    updateCompositeLine,
    deleteCompositeLine,
    moveCompositeLine,
    addTriangle,
    updateTriangle,
    deleteTriangles,
    clearTriangles,
    toggleSelect,
    toggleSelectAll,
    setAlignmentOverride,
    removePoint,
    removeSelected,
    clearPoints: clearGenerated,
    save,
    load,
    reset,
    start,
  };
}
