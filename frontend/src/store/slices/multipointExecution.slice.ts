import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  AtomicStatus,
  AtomicStep,
  EnginePhase,
  PointExecState,
} from '@/types/multipointExecution';

export type MultipointExecutionState = {
  phase: EnginePhase;
  runId: string | null;
  currentPointId: string | null;
  currentPointNo: number | null;
  // Two-pass: which pass is running (1 = indent-all, 2 = measure-all); null = single pass.
  pass: 1 | 2 | null;
  total: number;
  completedCount: number;
  // Per-point atomic status + metrics, keyed by generated point id.
  points: Record<string, PointExecState>;
  // Stable render order for the table (generated point order).
  order: string[];
  startedAtMs: number | null;
  finishedAtMs: number | null;
  statusMessage: string;
  errorMessage: string | null;
};

const INITIAL_STATE: MultipointExecutionState = {
  phase: 'idle',
  runId: null,
  currentPointId: null,
  currentPointNo: null,
  pass: null,
  total: 0,
  completedCount: 0,
  points: {},
  order: [],
  startedAtMs: null,
  finishedAtMs: null,
  statusMessage: 'Idle.',
  errorMessage: null,
};

function freshPoint(pointId: string, pointNo: number): PointExecState {
  return {
    pointId,
    pointNo,
    move: 'pending',
    focus: 'pending',
    indent: 'pending',
    measure: 'pending',
    hv: null,
    d1Um: null,
    d2Um: null,
    durationMs: null,
    error: null,
  };
}

const slice = createSlice({
  name: 'multipointExecution',
  initialState: INITIAL_STATE,
  reducers: {
    runInitialized(
      state,
      action: PayloadAction<{
        runId: string;
        startedAtMs: number;
        points: Array<{ pointId: string; pointNo: number }>;
      }>
    ) {
      const { runId, startedAtMs, points } = action.payload;
      state.runId = runId;
      state.startedAtMs = startedAtMs;
      state.finishedAtMs = null;
      state.phase = 'moving';
      state.pass = null;
      state.total = points.length;
      state.completedCount = 0;
      state.currentPointId = null;
      state.currentPointNo = null;
      state.errorMessage = null;
      state.statusMessage = `Starting run of ${points.length} point(s)…`;
      state.points = {};
      state.order = [];
      for (const p of points) {
        state.points[p.pointId] = freshPoint(p.pointId, p.pointNo);
        state.order.push(p.pointId);
      }
    },
    phaseChanged(state, action: PayloadAction<{ phase: EnginePhase; message?: string }>) {
      state.phase = action.payload.phase;
      if (action.payload.message !== undefined) state.statusMessage = action.payload.message;
    },
    passChanged(state, action: PayloadAction<1 | 2 | null>) {
      state.pass = action.payload;
    },
    pointEntered(state, action: PayloadAction<{ pointId: string; pointNo: number }>) {
      state.currentPointId = action.payload.pointId;
      state.currentPointNo = action.payload.pointNo;
    },
    atomicStatusChanged(
      state,
      action: PayloadAction<{ pointId: string; step: AtomicStep; status: AtomicStatus }>
    ) {
      const point = state.points[action.payload.pointId];
      if (!point) return;
      point[action.payload.step] = action.payload.status;
    },
    pointMeasured(
      state,
      action: PayloadAction<{
        pointId: string;
        hv: number | null;
        d1Um: number | null;
        d2Um: number | null;
      }>
    ) {
      const point = state.points[action.payload.pointId];
      if (!point) return;
      point.hv = action.payload.hv;
      point.d1Um = action.payload.d1Um;
      point.d2Um = action.payload.d2Um;
    },
    pointDurationSet(state, action: PayloadAction<{ pointId: string; durationMs: number }>) {
      const point = state.points[action.payload.pointId];
      if (point) point.durationMs = action.payload.durationMs;
    },
    pointErrored(state, action: PayloadAction<{ pointId: string; error: string | null }>) {
      const point = state.points[action.payload.pointId];
      if (point) point.error = action.payload.error;
    },
    pointCompleted(state, action: PayloadAction<{ pointId: string }>) {
      // Count each point as completed at most once (re-measure does not double-count).
      const point = state.points[action.payload.pointId];
      if (point && point.indent === 'done' && state.completedCount < state.total) {
        state.completedCount += 1;
      }
    },
    runFinished(
      state,
      action: PayloadAction<{ phase: EnginePhase; finishedAtMs: number; message: string }>
    ) {
      state.phase = action.payload.phase;
      state.finishedAtMs = action.payload.finishedAtMs;
      state.statusMessage = action.payload.message;
      state.currentPointId = null;
      state.currentPointNo = null;
    },
    runErrored(state, action: PayloadAction<{ message: string }>) {
      state.phase = 'error';
      state.errorMessage = action.payload.message;
      state.statusMessage = action.payload.message;
    },
    executionReset() {
      return INITIAL_STATE;
    },
  },
});

export const {
  runInitialized,
  phaseChanged,
  passChanged,
  pointEntered,
  atomicStatusChanged,
  pointMeasured,
  pointDurationSet,
  pointErrored,
  pointCompleted,
  runFinished,
  runErrored,
  executionReset,
} = slice.actions;

export const multipointExecutionReducer = slice.reducer;
