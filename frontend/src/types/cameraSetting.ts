export const DEFAULT_ANALOG_GAIN = 6.748;
export const DEFAULT_EXPOSURE_TIME_MS = 110;

export const ANALOG_GAIN_MIN = 0;
export const ANALOG_GAIN_MAX = 24;
export const ANALOG_GAIN_STEP = 0.001;

export const EXPOSURE_TIME_MIN_MS = 1;
export const EXPOSURE_TIME_MAX_MS = 1000;
export const EXPOSURE_TIME_STEP_MS = 1;

export type CameraSettingPayload = {
  analogGain: number;
  exposureTimeMs: number;
};

export type CameraSetting = CameraSettingPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type CameraSettingSavePayload = {
  id?: string;
  values: CameraSettingPayload;
};
