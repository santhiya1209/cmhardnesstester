export type XySpeed = 'slow' | 'mid' | 'fast' | 'ultra';
export type ZSpeed = 'ultra' | 'fast' | 'slow';
export type FocusMode = 'manual' | 'cFocus' | 'fFocus';

export type XYZPlatformStatePayload = {
  xySpeed: XySpeed;
  zSpeed: ZSpeed;
  platformX: number;
  platformY: number;
  platformZ: number;
  xyLocked: boolean;
  zLocked: boolean;
  focusMode: FocusMode;
  lastAction: string;
};

export type XYZPlatformState = XYZPlatformStatePayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
