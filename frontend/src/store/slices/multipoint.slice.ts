import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MultipointState, ProgramMeta } from '@/types/multipoint';
import type { FreePoint, PatternGenerationRequest, PatternMode, PatternPoint } from '@/types/patternProgram';

const INITIAL_CONFIG: PatternGenerationRequest = {
  mode: 'Horizontal Mode',
  refX: null,
  refY: null,
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
      clearGenerated(state);
      // Switching modes cancels any in-flight camera point selection.
      state.cameraPointPhase = 'idle';
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
    // Camera-click point selection (Free/Midpoint "Pick on Camera").
    startCameraPointSelect(state) {
      state.cameraPointPhase = 'selecting';
    },
    setCameraPointMoving(state) {
      state.cameraPointPhase = 'moving';
    },
    endCameraPointSelect(state) {
      state.cameraPointPhase = 'idle';
    },
    // Append one operator-captured free point (camera-click capture stores the
    // ACTUAL landed stage position). Invalidates the stale preview, exactly as
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
  setCameraPointMoving,
  endCameraPointSelect,
  appendFreePoint,
  resetMultipoint,
} = multipointSlice.actions;

export const multipointReducer = multipointSlice.reducer;
