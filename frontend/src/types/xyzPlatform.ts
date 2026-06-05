
import type { XySpeed, ZSpeed } from './xyzPlatformState';

export type { XySpeed, ZSpeed };

export type XyzDirection =
  | 'left'
  | 'right'
  | 'forward'
  | 'back'
  | 'forward-left'
  | 'forward-right'
  | 'back-left'
  | 'back-right';

export type ZDirection = 'up' | 'down';

export type XyzSerialMode = 'separate' | 'shared' | 'unknown';

export interface XyzPosition {
  x: number;
  y: number;
  z: number;
}

/** Mirrors the backend xyz-platform action-route result shape. */
export type XyzCommandResult =
  | { ok: true; position?: XyzPosition; rx?: string; commandId: string }
  | { ok: false; error: string; commandId?: string; message?: string };

/** Live stage state broadcast over the `xyz-platform:state` IPC event. */
export interface XyzStageState {
  connected: boolean;
  port: string | null;
  serialMode: XyzSerialMode;
  position: XyzPosition;
  xySpeed: XySpeed;
  zSpeed: ZSpeed;
  xyLocked: boolean;
  zLocked: boolean;
  moving: boolean;
  lastAction: string;
  lastError?: string;
  lastTx?: string;
  lastRx?: string;
  lastCommandId?: string;
  updatedAt: string;
}

export interface XyzStageStateResponse {
  ok: boolean;
  state: XyzStageState;
  error?: string;
  message?: string;
}
