export type CameraPixelFormat = 'mono8' | 'rgb24' | 'bgr24' | 'rgb32' | 'bgr32' | 'raw';

export type CameraStatus = {
  ok?: boolean;
  sdkLoaded: boolean;
  open: boolean;
  streaming: boolean;
  width: number;
  height: number;
  lastError: string | null;
  /** Optional surface fields propagated from the sidecar. */
  event?: string;
  error?: string;
  message?: string;
};

export type CameraFrameMeta = {
  width: number;
  height: number;
  pixelFormat: CameraPixelFormat;
  bits: 8 | 16;
  timestamp: number;
  seq: number;
  bytes: number;
  /** Main-process monotonic id used for ack-based flow control. */
  frameId?: number;
  /** Date.now() when the main process received this frame from native. */
  capturedAt?: number;
  /** Date.now() when the main process called webContents.send(). */
  sentAt?: number;
};

export type CameraDevice = { index: number; name: string };

export type CameraReply<Extra = Record<string, unknown>> = {
  ok: boolean;
  error?: string;
  message?: string;
} & Partial<Extra>;
