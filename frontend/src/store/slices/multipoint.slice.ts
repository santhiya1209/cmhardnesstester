import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { CameraPointTarget, MultipointState, ProgramMeta } from '@/types/multipoint';
import type { FreePoint, PatternGenerationRequest, PatternMode, PatternPoint } from '@/types/patternProgram';

const INITIAL_CONFIG: PatternGenerationRequest = {
  mode: 'Horizontal Mode',
  // Single-reference modes (Horizontal/Vertical) open at a clean 0,0 — the
  // reference is only ever set by an explicit crosshair capture, never preloaded
  // from the live stage position or a prior session.
  refX: 0,
  refY: 0,
  interval: null,
  offset: null,
  firstOffset: null,
  number: null,
  intervalY: null,
  rows: null,
  columns: null,
  refX2: null,
  refY2: null,
  radius: null,
  freePoints: [],
  referencePoints: [],
  angle: null,
  lines: [],
  triangles: [],
};

const INITIAL_STATE: MultipointState = {
  mode: 'Horizontal Mode',
  config: INITIAL_CONFIG,
  generatedPoints: [],
  selectedPointIds: [],
  isGenerating: false,
  programMeta: { pattern: 'Line', multiset: false, focusAll: false, impressMode: 'indenting' },
  activePointId: null,
  completedPointIds: [],
  failedPointIds: [],
  cameraPointPhase: 'idle',
  cameraPointTarget: null,
  referencePicked: false,
};

// Editing any generation input invalidates the previous preview, so points +
// selection clear together — there is never stale pattern data in the store.
function clearGenerated(state: MultipointState): void {
  state.generatedPoints = [];
  state.selectedPointIds = [];
  state.activePointId = null;
  state.completedPointIds = [];
  state.failedPointIds = [];
}

const multipointSlice = createSlice({
  name: 'multipoint',
  initialState: INITIAL_STATE,
  reducers: {
    setMode(state, action: PayloadAction<PatternMode>) {
      state.mode = action.payload;
      state.config.mode = action.payload;
      // Entering a single-reference linear mode starts the reference clean: no
      // carryover of a reference captured/typed/loaded earlier in the session.
      // The operator must capture it explicitly from the live crosshair. (Load
      // dispatches setMode BEFORE updateConfig, so a loaded program's reference is
      // re-applied right after this and is preserved.)
      if (action.payload === 'Horizontal Mode' || action.payload === 'Vertical Mode') {
        state.config.refX = 0;
        state.config.refY = 0;
      }
      clearGenerated(state);
      // Switching modes cancels any in-flight camera point selection and drops the
      // picked-reference marker — the new mode starts with no reference selected.
      state.cameraPointPhase = 'idle';
      state.cameraPointTarget = null;
      state.referencePicked = false;
    },
    updateConfig(state, action: PayloadAction<Partial<PatternGenerationRequest>>) {
      state.config = { ...state.config, ...action.payload };
      clearGenerated(state);
    },
    updateProgramMeta(state, action: PayloadAction<Partial<ProgramMeta>>) {
      state.programMeta = { ...state.programMeta, ...action.payload };
    },
    setGenerating(state, action: PayloadAction<boolean>) {
      state.isGenerating = action.payload;
    },
    setGeneratedPoints(state, action: PayloadAction<PatternPoint[]>) {
      state.generatedPoints = action.payload;
      state.selectedPointIds = [];
      state.isGenerating = false;
      state.activePointId = null;
      state.completedPointIds = [];
      state.failedPointIds = [];
    },
    setActivePoint(state, action: PayloadAction<string | null>) {
      state.activePointId = action.payload;
    },
    // Reset the per-run execution markers at the start of a Start run, leaving the
    // generated points + selection intact (unlike clearPoints which wipes them).
    resetExecutionProgress(state) {
      state.activePointId = null;
      state.completedPointIds = [];
      state.failedPointIds = [];
    },
    markPointCompleted(state, action: PayloadAction<string>) {
      if (!state.completedPointIds.includes(action.payload)) {
        state.completedPointIds.push(action.payload);
      }
      // A re-run that now succeeds clears any prior failure for the same point.
      state.failedPointIds = state.failedPointIds.filter((id) => id !== action.payload);
    },
    markPointFailed(state, action: PayloadAction<string>) {
      if (!state.failedPointIds.includes(action.payload)) {
        state.failedPointIds.push(action.payload);
      }
    },
    setSelectedPointIds(state, action: PayloadAction<string[]>) {
      state.selectedPointIds = action.payload;
    },
    deletePoint(state, action: PayloadAction<string>) {
      state.generatedPoints = state.generatedPoints.filter((point) => point.id !== action.payload);
      state.selectedPointIds = state.selectedPointIds.filter((id) => id !== action.payload);
    },
    deletePoints(state, action: PayloadAction<string[]>) {
      const remove = new Set(action.payload);
      state.generatedPoints = state.generatedPoints.filter((point) => !remove.has(point.id));
      state.selectedPointIds = state.selectedPointIds.filter((id) => !remove.has(id));
    },
    clearPoints(state) {
      clearGenerated(state);
    },
    // Camera-click point selection. The payload says what the next click sets:
    // 'freePoint' (Free/Midpoint) or 'reference' (Horizontal/Vertical refX/refY).
    startCameraPointSelect(state, action: PayloadAction<CameraPointTarget>) {
      state.cameraPointPhase = 'selecting';
      state.cameraPointTarget = action.payload;
    },
    endCameraPointSelect(state) {
      state.cameraPointPhase = 'idle';
      state.cameraPointTarget = null;
    },
    // Set the single reference point (refX/refY) the offset/interval generation
    // uses as its origin — from a camera click (the clicked LOCATION's mm), never
    // the live stage position. Marks the reference picked (drives the marker) and
    // invalidates the stale preview, exactly as editing any generation input does.
    setReferencePoint(state, action: PayloadAction<{ x: number; y: number }>) {
      state.config.refX = action.payload.x;
      state.config.refY = action.payload.y;
      state.referencePicked = true;
      clearGenerated(state);
    },
    // Mark the reference explicitly established so it stops tracking the live stage
    // position — used when the operator types a Matrix reference, or a saved program
    // is loaded. The establishing action (updateConfig / load) owns the coordinates
    // and preview; this only flips the flag.
    markReferenceEstablished(state) {
      state.referencePicked = true;
    },
    // Append one operator-captured free point. The camera-click "Add Point" stores
    // the clicked LOCATION (live stage centre + pixel offset, absolute mm); Capture
    // Position stores the live centre. Invalidates the stale preview, exactly as
    // editing any other generation input does.
    appendFreePoint(state, action: PayloadAction<FreePoint>) {
      state.config.freePoints = [...(state.config.freePoints ?? []), action.payload];
      clearGenerated(state);
    },
    selectPoint(state, action: PayloadAction<string>) {
      if (!state.selectedPointIds.includes(action.payload)) {
        state.selectedPointIds.push(action.payload);
      }
    },
    deselectPoint(state, action: PayloadAction<string>) {
      state.selectedPointIds = state.selectedPointIds.filter((id) => id !== action.payload);
    },
    resetMultipoint() {
      return INITIAL_STATE;
    },
  },
});

export const {
  setMode,
  updateConfig,
  updateProgramMeta,
  setGenerating,
  setGeneratedPoints,
  setActivePoint,
  resetExecutionProgress,
  markPointCompleted,
  markPointFailed,
  setSelectedPointIds,
  deletePoint,
  deletePoints,
  clearPoints,
  selectPoint,
  deselectPoint,
  startCameraPointSelect,
  endCameraPointSelect,
  setReferencePoint,
  markReferenceEstablished,
  appendFreePoint,
  resetMultipoint,
} = multipointSlice.actions;

export const multipointReducer = multipointSlice.reducer;
