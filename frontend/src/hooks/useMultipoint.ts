import { useCallback, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  clearPoints,
  deletePoint,
  deletePoints,
  deselectPoint,
  resetMultipoint,
  selectPoint,
  setActivePoint,
  setGenerating,
  setGeneratedPoints,
  setMode,
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
import { generatePattern } from '@/utils/patternGeneration';
import { buildMultipointExecutionRequest } from '@/utils/multipointExecution';
import { configFromProgram, metaFromProgram, toPayload } from '@/utils/patternProgramMapping';
import type { ProgramMeta } from '@/types/multipoint';
import type { FreePoint, PatternGenerationRequest, PatternMode } from '@/types/patternProgram';

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
  const [executing, setExecuting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('No saved pattern program yet.');
  // Bumped on Load/Reset to remount the (uncontrolled) numeric inputs so they
  // re-read the replaced config — without storing per-keystroke string buffers.
  const [formRevision, setFormRevision] = useState(0);

  const loadedProgram = patternPrograms.find((program) => program.id === loadedProgramId) ?? null;
  const errorMessage = patternProgramsError ?? saveError ?? generationError;
  const isBusy = patternProgramsLoading || saving || executing;

  const changeMode = useCallback((value: PatternMode) => dispatch(setMode(value)), [dispatch]);
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
    dispatch(setGenerating(true));
    const result = generatePattern(config);
    if (!result.success) {
      setGenerationError(result.error ?? 'Pattern generation failed.');
      setStatusMessage('Generation failed.');
      dispatch(setGenerating(false));
      return;
    }
    setGenerationError(null);
    dispatch(setGeneratedPoints(result.points));
    setStatusMessage(`Generated ${result.points.length} point(s) using ${mode}.`);
  }, [config, mode, dispatch]);

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
    (slot: typeof CASE_DEPTH_ORIGIN | typeof CASE_DEPTH_DIRECTION) => {
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

  // Fine-tune an already-captured reference point in place; the slot must exist
  // (the UI only enables a slot's inputs once it has been captured).
  const updateReferencePoint = useCallback(
    (slot: number, patch: Partial<FreePoint>) => {
      const next = (config.referencePoints ?? []).map((point, i) => (i === slot ? { ...point, ...patch } : point));
      dispatch(updateConfig({ referencePoints: next }));
    },
    [config.referencePoints, dispatch]
  );

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
    try {
      for (let i = 0; i < request.points.length; i += 1) {
        const point = request.points[i];
        // Mark the live target so the camera pattern overlay highlights it.
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
    updateReferencePoint,
    toggleSelect,
    removePoint,
    removeSelected,
    clearPoints: clearGenerated,
    save,
    load,
    reset,
    start,
  };
}
