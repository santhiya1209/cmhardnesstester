export type CalibrationSettingsPayload = {
  objective: string;
  normalizedObjective?: string;
  pixelToMicron: number;
  umPerPixel?: number;
  pixelPerMm?: number;
  active?: boolean;
  calibrationDate: string;
};

export type CalibrationSettingsSavePayload = {
  objective: string;
  pixelToMicron: number;
  umPerPixel?: number;
  pixelPerMm?: number;
  active?: boolean;
};

export type CalibrationSettings = CalibrationSettingsPayload & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
